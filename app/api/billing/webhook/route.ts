import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAnalyticsEvent } from "../../../lib/analytics/store-file";
import { verifyBillingWebhookAuth } from "../../../lib/billing/providerAdapter";
import { consumeBillingWebhookReplayKey } from "../../../lib/billing/webhookReplayStore";
import { appendBillingWebhookDeadLetter } from "../../../lib/billing/webhookDeadLetter";
import { recordBillingWebhookMetric } from "../../../lib/billing/webhookObservability";
import { transitionDonationStatus, type DonationStatus } from "../../../lib/donations/store";
import {
  ensureUserForWebhook,
  grantEntitlement,
  revokeEntitlement,
  upsertOrder,
} from "../../../lib/auth/store";
import { allowRateLimit } from "../../../lib/security/rateLimit";

type BillingWebhookPayload = {
  action?: "grant" | "revoke";
  entitlementCode?: string;
  expiresAt?: string | null;
  source?: string;
  userId?: string;
  email?: string;
  name?: string;
  provider?: string;
  providerRef?: string;
  orderStatus?: string;
  amountMinor?: number;
  currency?: string;
};

const DEFAULT_MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;

function parseIsoOrNull(input: string | null | undefined): string | null {
  if (!input) return null;
  const ts = new Date(input).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function normalizeDonationStatus(action: "grant" | "revoke", rawOrderStatus: string | undefined): DonationStatus {
  const normalized = rawOrderStatus?.trim().toLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "requires_action") return "requires_action";
  if (normalized === "succeeded") return "succeeded";
  if (normalized === "failed") return "failed";
  if (normalized === "canceled") return "canceled";
  if (normalized === "refunded") return "refunded";
  return action === "grant" ? "succeeded" : "refunded";
}

function normalizeReplayToken(raw: string | undefined, maxLength = 180): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

function buildReplayKey(params: {
  eventId: string;
  payload: BillingWebhookPayload;
  action: "grant" | "revoke";
  entitlementCode: string;
  rawPayload: string;
}): string {
  const normalizedEventId = normalizeReplayToken(params.eventId, 220);
  if (normalizedEventId) return `event:${normalizedEventId}`;

  const provider = normalizeReplayToken(params.payload.provider, 80);
  const providerRef = normalizeReplayToken(params.payload.providerRef, 220);
  const status = normalizeReplayToken(params.payload.orderStatus, 80) || "none";
  const entitlement = normalizeReplayToken(params.entitlementCode, 120) || "none";
  const actor = normalizeReplayToken(params.payload.userId || params.payload.email, 180) || "anon";

  if (provider && providerRef) {
    return `provider:${provider}:${providerRef}:${params.action}:${entitlement}:${status}:${actor}`;
  }

  const payloadDigest = createHash("sha256").update(params.rawPayload).digest("hex");
  return `payload:${payloadDigest}:${params.action}:${entitlement}:${status}:${actor}`;
}

export async function POST(request: NextRequest) {
  const respond = async (params: {
    status: number;
    reasonCode: string;
    authMode?: "signature" | "legacy-secret" | "unknown";
    body?: Record<string, unknown>;
  }) => {
    await recordBillingWebhookMetric({
      reasonCode: params.reasonCode,
      authMode: params.authMode || "unknown",
    });
    return NextResponse.json(
      {
        reasonCode: params.reasonCode,
        ...(params.body || {}),
      },
      { status: params.status }
    );
  };

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`billing-webhook:${ip}`, 120, 60_000)) {
    await appendBillingWebhookDeadLetter({
      reason: "rate_limited",
      ip,
    });
    return respond({
      status: 429,
      reasonCode: "rate_limited",
      body: { error: "Too many requests" },
    });
  }

  const configuredSecret = process.env.RR_BILLING_WEBHOOK_SECRET?.trim() || "";
  if (!configuredSecret) {
    await appendBillingWebhookDeadLetter({
      reason: "secret_not_configured",
      ip,
    });
    return respond({
      status: 503,
      reasonCode: "secret_not_configured",
      body: { error: "Webhook secret is not configured" },
    });
  }

  const configuredMaxPayloadBytesRaw = Number(process.env.RR_BILLING_WEBHOOK_MAX_BYTES);
  const maxPayloadBytes =
    Number.isFinite(configuredMaxPayloadBytesRaw) && configuredMaxPayloadBytesRaw > 0
      ? Math.trunc(configuredMaxPayloadBytesRaw)
      : DEFAULT_MAX_WEBHOOK_PAYLOAD_BYTES;
  const contentLengthRaw = request.headers.get("content-length");
  if (contentLengthRaw) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
      await appendBillingWebhookDeadLetter({
        reason: "payload_too_large",
        ip,
      });
      return respond({
        status: 413,
        reasonCode: "payload_too_large",
        body: { error: "Payload too large" },
      });
    }
  }

  let rawPayload = "";
  try {
    rawPayload = await request.text();
  } catch {
    await appendBillingWebhookDeadLetter({
      reason: "payload_read_error",
      ip,
    });
    return respond({
      status: 400,
      reasonCode: "payload_read_error",
      body: { error: "Unable to read payload" },
    });
  }
  if (Buffer.byteLength(rawPayload, "utf8") > maxPayloadBytes) {
    await appendBillingWebhookDeadLetter({
      reason: "payload_too_large",
      ip,
      rawPayload,
    });
    return respond({
      status: 413,
      reasonCode: "payload_too_large",
      body: { error: "Payload too large" },
    });
  }

  const auth = verifyBillingWebhookAuth({
    headers: request.headers,
    rawPayload,
    secret: configuredSecret,
  });
  if (!auth.ok) {
    const reasonCode = `auth_${auth.reason}`;
    await appendBillingWebhookDeadLetter({
      reason: "unauthorized",
      ip,
      rawPayload,
      action: auth.reason,
    });
    return respond({
      status: 401,
      reasonCode,
      authMode: auth.mode,
      body: {
        error: "Unauthorized",
        authMode: auth.mode,
      },
    });
  }

  let payload: BillingWebhookPayload = {};
  try {
    payload = JSON.parse(rawPayload) as BillingWebhookPayload;
  } catch {
    await appendBillingWebhookDeadLetter({
      reason: "invalid_json_payload",
      ip,
      rawPayload,
    });
    return respond({
      status: 400,
      reasonCode: "invalid_json_payload",
      authMode: auth.mode,
      body: { error: "Invalid JSON payload", authMode: auth.mode },
    });
  }

  const action = payload.action;
  if (action !== "grant" && action !== "revoke") {
    await appendBillingWebhookDeadLetter({
      reason: "invalid_action",
      ip,
      action: typeof payload.action === "string" ? payload.action : undefined,
      provider: payload.provider,
      providerRef: payload.providerRef,
      entitlementCode: payload.entitlementCode,
      userId: payload.userId,
      email: payload.email,
      rawPayload,
    });
    return respond({
      status: 400,
      reasonCode: "invalid_action",
      authMode: auth.mode,
      body: { error: "Invalid action", authMode: auth.mode },
    });
  }

  const entitlementCode = payload.entitlementCode?.trim();
  if (!entitlementCode) {
    await appendBillingWebhookDeadLetter({
      reason: "entitlement_missing",
      ip,
      action,
      provider: payload.provider,
      providerRef: payload.providerRef,
      userId: payload.userId,
      email: payload.email,
      rawPayload,
    });
    return respond({
      status: 400,
      reasonCode: "entitlement_missing",
      authMode: auth.mode,
      body: { error: "entitlementCode is required", authMode: auth.mode },
    });
  }

  const replayEventId = request.headers.get("x-rr-webhook-event-id")?.trim() || "";
  const replayKey = buildReplayKey({
    eventId: replayEventId,
    payload,
    action,
    entitlementCode,
    rawPayload,
  });
  const replay = await consumeBillingWebhookReplayKey(replayKey);
  if (replay.duplicate) {
    await appendBillingWebhookDeadLetter({
      reason: "replay_duplicate",
      ip,
      action,
      provider: payload.provider,
      providerRef: payload.providerRef,
      entitlementCode,
      userId: payload.userId,
      email: payload.email,
    });
    return respond({
      status: 200,
      reasonCode: "replay_duplicate",
      authMode: auth.mode,
      body: {
        ok: true,
        duplicate: true,
        action,
        entitlementCode,
        authMode: auth.mode,
      },
    });
  }

  const sourceTag = payload.source?.trim() || "billing-webhook";
  const isDonationSignal =
    !!payload.provider &&
    !!payload.providerRef &&
    (sourceTag.toLowerCase().includes("donate") || entitlementCode.toLowerCase().includes("donate"));
  const donationStatus = normalizeDonationStatus(action, payload.orderStatus);
  if (isDonationSignal && payload.provider && payload.providerRef) {
    await transitionDonationStatus({
      provider: payload.provider,
      providerRef: payload.providerRef,
      nextStatus: donationStatus,
      source: sourceTag,
      reason: payload.orderStatus?.trim(),
      userId: payload.userId?.trim(),
      amountMinor: typeof payload.amountMinor === "number" ? payload.amountMinor : undefined,
      currency: payload.currency?.trim(),
    });
  }

  const user = await ensureUserForWebhook({
    userId: payload.userId?.trim(),
    email: payload.email?.trim(),
    name: payload.name?.trim(),
  });
  if (!user) {
    await appendBillingWebhookDeadLetter({
      reason: "user_missing",
      ip,
      action,
      provider: payload.provider,
      providerRef: payload.providerRef,
      entitlementCode,
      userId: payload.userId,
      email: payload.email,
      rawPayload,
    });
    return respond({
      status: 400,
      reasonCode: "user_missing",
      authMode: auth.mode,
      body: {
        error: "User is required (userId or email)",
        authMode: auth.mode,
      },
    });
  }
  if (isDonationSignal && payload.provider && payload.providerRef) {
    await transitionDonationStatus({
      provider: payload.provider,
      providerRef: payload.providerRef,
      nextStatus: donationStatus,
      source: sourceTag,
      reason: payload.orderStatus?.trim(),
      userId: user.id,
      amountMinor: typeof payload.amountMinor === "number" ? payload.amountMinor : undefined,
      currency: payload.currency?.trim(),
    });
  }

  if (payload.provider && payload.providerRef) {
    await upsertOrder({
      userId: user.id,
      provider: payload.provider,
      providerRef: payload.providerRef,
      status: payload.orderStatus || (action === "grant" ? "paid" : "revoked"),
      amountMinor:
        typeof payload.amountMinor === "number" && Number.isFinite(payload.amountMinor)
          ? Math.trunc(payload.amountMinor)
          : undefined,
      currency: payload.currency?.trim(),
    });
  }

  if (action === "grant") {
    await grantEntitlement({
      userId: user.id,
      code: entitlementCode,
      source: sourceTag,
      expiresAt: parseIsoOrNull(payload.expiresAt),
    });
    const providerPart = payload.provider?.trim() || "manual";
    const providerRefPart = payload.providerRef?.trim() || entitlementCode;
    await createAnalyticsEvent({
      contentType: "commerce",
      contentId: entitlementCode.slice(0, 180),
      eventType: "purchase",
      userId: user.id,
      source: sourceTag,
      dedupeKey: `purchase:${providerPart}:${providerRefPart}:${user.id}`,
    });
  } else {
    await revokeEntitlement({
      userId: user.id,
      code: entitlementCode,
    });
  }

  return respond({
    status: 200,
    reasonCode: "processed",
    authMode: auth.mode,
    body: {
      ok: true,
      action,
      userId: user.id,
      entitlementCode,
      authMode: auth.mode,
    },
  });
}
