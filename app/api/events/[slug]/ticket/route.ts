import { NextResponse, type NextRequest } from "next/server";
import { createAnalyticsEvent } from "../../../../lib/analytics/store-file";
import { getPublishedEventBySlug } from "../../../../lib/eventsCatalog";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type RouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { slug } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`events-ticket:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const event = getPublishedEventBySlug(slug);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  await createAnalyticsEvent({
    contentType: "commerce",
    contentId: `event-ticket:${slug}`,
    eventType: "paywall_click",
    source: "events-ticket",
    dedupeKey: `events-ticket:${slug}:${new Date().toISOString().slice(0, 16)}:${ip}`,
  });

  return NextResponse.redirect(event.ticketUrl, 307);
}
