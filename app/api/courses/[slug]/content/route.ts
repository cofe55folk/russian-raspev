import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest, sessionHasEntitlement } from "../../../../lib/auth/session";
import {
  getCourseBySlug,
  getCoursePremiumEntitlementCode,
  type CourseMediaItem,
  type CourseTextItem,
} from "../../../../lib/coursesCatalog";
import { issueMediaAccessToken } from "../../../../lib/media/accessToken";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

type PublicMediaItem = CourseMediaItem & {
  locked?: boolean;
};

type PublicTextItem = CourseTextItem & {
  locked?: boolean;
};

function signMediaItems(items: CourseMediaItem[], entitlementCode: string, slug: string): PublicMediaItem[] {
  return items.map((item) => {
    if (item.src.startsWith("http://") || item.src.startsWith("https://")) {
      return {
        ...item,
        src: `/api/courses/${encodeURIComponent(slug)}/open?itemId=${encodeURIComponent(item.id)}`,
      };
    }
    const exp = Date.now() + 5 * 60 * 1000;
    const token = issueMediaAccessToken({
      src: item.src,
      exp,
      entitlementCode,
    });
    return {
      ...item,
      src: `/api/media/stream?token=${encodeURIComponent(token)}`,
    };
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`course-content:${ip}:${slug}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const course = getCourseBySlug(slug);
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const requiredEntitlement = getCoursePremiumEntitlementCode(course);
  const session = await readAuthSessionFromRequest(request);
  const premiumUnlocked = sessionHasEntitlement(session, requiredEntitlement);

  const premiumVideos: PublicMediaItem[] = requiredEntitlement && premiumUnlocked
    ? signMediaItems(course.premiumVideos, requiredEntitlement, course.slug)
    : course.premiumVideos.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        src: "",
        durationMin: item.durationMin,
        locked: true,
      }));

  const premiumAudios: PublicMediaItem[] = requiredEntitlement && premiumUnlocked
    ? signMediaItems(course.premiumAudios, requiredEntitlement, course.slug)
    : course.premiumAudios.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        src: "",
        durationMin: item.durationMin,
        locked: true,
      }));

  const premiumTexts: PublicTextItem[] = premiumUnlocked
    ? course.premiumTexts
    : course.premiumTexts.map((item) => ({
        ...item,
        href: "",
        locked: true,
      }));

  return NextResponse.json({
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle || "",
    requiredEntitlement,
    premiumUnlocked,
    free: {
      videos: course.freeVideos,
      audios: course.freeAudios,
      texts: course.freeTexts,
    },
    premium: {
      videos: premiumVideos,
      audios: premiumAudios,
      texts: premiumTexts,
    },
    counts: {
      freeVideos: course.freeVideos.length,
      premiumVideos: course.premiumVideos.length,
      freeAudios: course.freeAudios.length,
      premiumAudios: course.premiumAudios.length,
      freeTexts: course.freeTexts.length,
      premiumTexts: course.premiumTexts.length,
    },
  });
}
