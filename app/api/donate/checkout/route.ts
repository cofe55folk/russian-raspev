import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomUUID } from "crypto";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";
import { createAnalyticsEvent } from "../../../lib/analytics/store-file";
import { createDonateCheckout } from "../../../lib/billing/providerAdapter";
import { createDonationIntent, transitionDonationStatus } from "../../../lib/donations/store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type DonateCheckoutInterval = "once" | "monthly";
type DonateCheckoutMode = "mock" | "external";

type DonateCheckoutRequestBody = {
  amountRub?: number;
  interval?: DonateCheckoutInterval;
  returnPath?: string;
  preferMock?: boolean;
  checkoutMode?: DonateCheckoutMode;
};

function normalizeInterval(raw: unknown): DonateCheckoutInterval {
  return raw === "monthly" ? "monthly" : "once";
}

function normalizeAmountRub(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const normalized = Math.trunc(raw);
  if (normalized < 50 || normalized > 250_000) return null;
  return normalized;
}

function normalizeReturnPath(raw: unknown): string {
  if (typeof raw !== "string") return "/donate";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return "/donate";
  if (trimmed.startsWith("//")) return "/donate";
  return trimmed || "/donate";
}

function normalizeCheckoutMode(raw: unknown): DonateCheckoutMode | null {
  if (raw === "mock") return "mock";
  if (raw === "external") return "external";
  return null;
}

function redirectFailure(origin: string, returnPath: string, reason: string): NextResponse {
  const url = new URL(returnPath, origin);
  url.searchParams.set("status", "failed");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`donate-checkout:${ip}`, 90, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const redirectMode = request.nextUrl.searchParams.get("redirect") === "1";
  let body: DonateCheckoutRequestBody = {};
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = (await request.json()) as DonateCheckoutRequestBody;
    } else {
      const formData = await request.formData();
      const amountRaw = formData.get("amountRub");
      const intervalRaw = formData.get("interval");
      const returnPathRaw = formData.get("returnPath");
      const preferMockRaw = formData.get("preferMock");
      const checkoutModeRaw = formData.get("checkoutMode");
      body = {
        amountRub: typeof amountRaw === "string" ? Number(amountRaw) : undefined,
        interval: intervalRaw === "monthly" ? "monthly" : "once",
        returnPath: typeof returnPathRaw === "string" ? returnPathRaw : undefined,
        preferMock: preferMockRaw === "1",
        checkoutMode: checkoutModeRaw === "mock" || checkoutModeRaw === "external" ? checkoutModeRaw : undefined,
      };
    }
  } catch {
    if (redirectMode) {
      return redirectFailure(request.nextUrl.origin, "/donate", "invalid_payload");
    }
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  const returnPath = normalizeReturnPath(body.returnPath);
  const amountRub = normalizeAmountRub(body.amountRub);
  if (!amountRub) {
    if (redirectMode) {
      return redirectFailure(request.nextUrl.origin, returnPath, "invalid_amount");
    }
    return NextResponse.json({ error: "amountRub must be an integer from 50 to 250000" }, { status: 400 });
  }
  const amountMinor = amountRub * 100;
  const interval = normalizeInterval(body.interval);
  const requestedMode = normalizeCheckoutMode(body.checkoutMode);
  const preferMock = requestedMode === "mock" ? true : requestedMode === "external" ? false : body.preferMock;

  const returnUrl = new URL(returnPath, request.nextUrl.origin);
  const providerRef = `donate_${randomUUID()}`;
  let checkout;
  try {
    checkout = await createDonateCheckout({
      amountMinor,
      interval,
      returnUrl,
      providerRef,
      source: "rr-donate-page",
      preferMock,
    });
    if (requestedMode === "external" && checkout.mode !== "external") {
      throw new Error("external_checkout_unavailable");
    }
  } catch {
    if (redirectMode) {
      return redirectFailure(request.nextUrl.origin, returnPath, "provider_unavailable");
    }
    return NextResponse.json({ error: "Checkout provider is unavailable" }, { status: 503 });
  }
  const useMock = checkout.mode === "mock";
  const provider = checkout.provider;
  const checkoutUrl = checkout.checkoutUrl;

  const session = await readAuthSessionFromRequest(request);
  const userAgent = request.headers.get("user-agent") || "";
  const anonymousId = session?.userId
    ? undefined
    : `anon:${createHash("sha256").update(`${ip}|${userAgent}`).digest("hex").slice(0, 24)}`;
  const intent = await createDonationIntent({
    provider,
    providerRef,
    amountMinor,
    currency: "RUB",
    interval,
    userId: session?.userId,
    anonymousId,
    source: useMock ? "donate-mock-checkout" : "donate-checkout",
    returnPath,
    checkoutUrl,
    status: "pending",
  });

  if (useMock) {
    await transitionDonationStatus({
      provider,
      providerRef,
      nextStatus: "succeeded",
      source: "donate-mock-return",
      userId: session?.userId,
      amountMinor,
      currency: "RUB",
    });
  }

  await createAnalyticsEvent({
    contentType: "commerce",
    contentId: `donate:${interval}:${amountMinor}:${providerRef}`,
    eventType: "donate_checkout_start",
    userId: session?.userId,
    source: useMock ? "donate-mock-checkout" : "donate-checkout",
    dedupeKey: `donate-checkout:${session?.userId ?? ip}:${providerRef}`,
  });

  if (redirectMode) {
    return NextResponse.redirect(checkoutUrl, 303);
  }

  return NextResponse.json({
    checkoutUrl,
    mode: useMock ? "mock" : "external",
    intentId: intent.id,
    providerRef,
  });
}
