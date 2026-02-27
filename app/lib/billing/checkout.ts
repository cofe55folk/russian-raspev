import type { MaterialOffer } from "../materialOffers";

function normalizeCheckoutUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function toSlugEnvSuffix(slug: string): string {
  return slug
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getCheckoutUrlForOffer(offer: Pick<MaterialOffer, "slug">): string | null {
  const suffix = toSlugEnvSuffix(offer.slug);
  const specific = normalizeCheckoutUrl(process.env[`RR_BILLING_CHECKOUT_URL_${suffix}`]);
  if (specific) return specific;
  return normalizeCheckoutUrl(process.env.RR_BILLING_CHECKOUT_DEFAULT_URL);
}

