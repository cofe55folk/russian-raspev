import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest, sessionHasEntitlement } from "../../../lib/auth/session";
import { getCheckoutUrlForOffer } from "../../../lib/billing/checkout";
import { getCourseByEntitlementCode } from "../../../lib/coursesCatalog";
import { MATERIAL_OFFERS } from "../../../lib/materialOffers";
import { allowRateLimit } from "../../../lib/security/rateLimit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`billing-products:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  const products = MATERIAL_OFFERS.map((offer) => {
    const linkedCourse = getCourseByEntitlementCode(offer.entitlementCode);
    const checkoutUrl = getCheckoutUrlForOffer(offer);
    return {
      id: offer.id,
      slug: offer.slug,
      title: offer.title,
      subtitle: offer.subtitle,
      entitlementCode: offer.entitlementCode,
      unlocked: sessionHasEntitlement(session, offer.entitlementCode),
      materialHref: `/materials/${offer.slug}`,
      courseHref: linkedCourse ? `/education/${linkedCourse.slug}` : null,
      checkoutUrl,
      checkoutConfigured: !!checkoutUrl,
      previewBullets: offer.previewBullets,
    };
  });

  return NextResponse.json({
    products,
    signedIn: !!session,
  });
}
