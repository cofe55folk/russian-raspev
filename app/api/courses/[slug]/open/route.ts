import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest, sessionHasEntitlement } from "../../../../lib/auth/session";
import { getCourseBySlug, getCoursePremiumEntitlementCode } from "../../../../lib/coursesCatalog";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`course-open:${ip}:${slug}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const course = getCourseBySlug(slug);
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const itemId = request.nextUrl.searchParams.get("itemId")?.trim() || "";
  if (!itemId) {
    return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  }

  const freeItem = [...course.freeVideos, ...course.freeAudios].find((item) => item.id === itemId);
  const premiumItem = [...course.premiumVideos, ...course.premiumAudios].find((item) => item.id === itemId);
  const found = freeItem || premiumItem;
  if (!found) {
    return NextResponse.json({ error: "Course item not found" }, { status: 404 });
  }
  if (!found.src.startsWith("http://") && !found.src.startsWith("https://")) {
    return NextResponse.json({ error: "Course item source is not external" }, { status: 400 });
  }

  if (premiumItem) {
    const requiredEntitlement = getCoursePremiumEntitlementCode(course);
    const session = await readAuthSessionFromRequest(request);
    if (!sessionHasEntitlement(session, requiredEntitlement)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.redirect(found.src);
}
