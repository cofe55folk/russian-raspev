import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const SESSION_COOKIE = "rr_auth_session_v1";
const WEBHOOK_SECRET = (process.env.RR_BILLING_WEBHOOK_SECRET || "").trim();
const ENTITLEMENT = "course:vocal:full";
const DONATIONS_LEDGER_PATH = path.join(process.cwd(), "data", "donations", "ledger.json");
const WEBHOOK_DEAD_LETTER_PATH = path.join(process.cwd(), "data", "billing", "webhook-dead-letter.jsonl");

function createSignatureHeaders(rawPayload: string, timestampSec: number) {
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${Math.floor(timestampSec)}.${rawPayload}`)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-rr-webhook-signature": `sha256=${signature}`,
    "x-rr-webhook-timestamp": String(Math.floor(timestampSec)),
  };
}

function readDeadLetterRows(): Array<Record<string, unknown>> {
  try {
    const raw = readFileSync(WEBHOOK_DEAD_LETTER_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((row): row is Record<string, unknown> => !!row);
  } catch {
    return [];
  }
}

test("billing webhook rejects unauthorized requests @critical-contract", async ({ request }) => {
  const response = await request.post("/api/billing/webhook", {
    data: {
      action: "grant",
      entitlementCode: ENTITLEMENT,
      email: `billing-unauthorized-${Date.now()}@example.com`,
      provider: "e2e",
      providerRef: `unauthorized-${Date.now()}`,
    },
  });

  if (WEBHOOK_SECRET) {
    expect(response.status()).toBe(401);
    const body = (await response.json()) as { reasonCode?: string; authMode?: string };
    expect(body.reasonCode).toBe("auth_legacy_secret_mismatch");
    expect(body.authMode).toBe("legacy-secret");
  } else {
    expect(response.status()).toBe(503);
    const body = (await response.json()) as { reasonCode?: string };
    expect(body.reasonCode).toBe("secret_not_configured");
  }
});

test("billing webhook rejects invalid signature when signature mode is used @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const timestamp = Math.floor(Date.now() / 1000);
  const response = await request.post("/api/billing/webhook", {
    headers: {
      "x-rr-webhook-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      "x-rr-webhook-timestamp": String(timestamp),
    },
    data: {
      action: "grant",
      entitlementCode: ENTITLEMENT,
      email: `billing-invalid-signature-${Date.now()}@example.com`,
      provider: "e2e",
      providerRef: `invalid-signature-${Date.now()}`,
    },
  });

  expect(response.status()).toBe(401);
  const body = (await response.json()) as { reasonCode?: string; authMode?: string };
  expect(body.reasonCode).toBe("auth_signature_mismatch");
  expect(body.authMode).toBe("signature");
});

test("billing webhook grant is idempotent for repeated providerRef @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const email = `billing-webhook-${Date.now()}@example.com`;
  const providerRef = `pay-${Date.now()}`;
  const payload = {
    action: "grant",
    entitlementCode: ENTITLEMENT,
    email,
    provider: "e2e",
    providerRef,
    orderStatus: "paid",
    amountMinor: 120000,
    currency: "RUB",
    source: "e2e-webhook",
  };

  const firstResponse = await request.post("/api/billing/webhook", {
    headers: { "x-rr-webhook-secret": WEBHOOK_SECRET },
    data: payload,
  });
  expect(firstResponse.ok()).toBeTruthy();
  const first = (await firstResponse.json()) as {
    userId: string;
    action: string;
    entitlementCode: string;
    reasonCode?: string;
  };
  expect(first.reasonCode).toBe("processed");
  expect(first.action).toBe("grant");
  expect(first.entitlementCode).toBe(ENTITLEMENT);

  const secondResponse = await request.post("/api/billing/webhook", {
    headers: { "x-rr-webhook-secret": WEBHOOK_SECRET },
    data: payload,
  });
  expect(secondResponse.ok()).toBeTruthy();
  const second = (await secondResponse.json()) as {
    userId?: string;
    action: string;
    entitlementCode: string;
    duplicate?: boolean;
    reasonCode?: string;
  };
  if (!second.duplicate) {
    expect(second.userId).toBe(first.userId);
    expect(second.reasonCode).toBe("processed");
  } else {
    expect(second.reasonCode).toBe("replay_duplicate");
  }
  expect(second.action).toBe("grant");
  expect(second.entitlementCode).toBe(ENTITLEMENT);

  const devLoginResponse = await request.post("/api/auth/dev-login", {
    data: { email },
  });
  expect(devLoginResponse.ok()).toBeTruthy();
  const loginPayload = (await devLoginResponse.json()) as { sessionId?: string };
  if (!loginPayload.sessionId) throw new Error("Missing sessionId from dev-login");

  const sessionResponse = await request.get("/api/auth/session", {
    headers: {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(loginPayload.sessionId)}`,
    },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const sessionPayload = (await sessionResponse.json()) as {
    session?: {
      entitlements?: Array<{ code: string }>;
    } | null;
  };
  const entitlementMatches = (sessionPayload.session?.entitlements || []).filter((item) => item.code === ENTITLEMENT);
  expect(entitlementMatches).toHaveLength(1);
});

test("billing webhook replay is ignored when same event-id is sent twice @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const email = `billing-replay-${Date.now()}@example.com`;
  const providerRef = `pay-replay-${Date.now()}`;
  const eventId = `evt-${Date.now()}`;
  const payload = {
    action: "grant",
    entitlementCode: ENTITLEMENT,
    email,
    provider: "e2e",
    providerRef,
    orderStatus: "paid",
    amountMinor: 120000,
    currency: "RUB",
    source: "e2e-webhook",
  };

  const firstResponse = await request.post("/api/billing/webhook", {
    headers: {
      "x-rr-webhook-secret": WEBHOOK_SECRET,
      "x-rr-webhook-event-id": eventId,
    },
    data: payload,
  });
  expect(firstResponse.ok()).toBeTruthy();
  const first = (await firstResponse.json()) as { duplicate?: boolean; reasonCode?: string };
  expect(first.duplicate ?? false).toBeFalsy();
  expect(first.reasonCode).toBe("processed");

  const secondResponse = await request.post("/api/billing/webhook", {
    headers: {
      "x-rr-webhook-secret": WEBHOOK_SECRET,
      "x-rr-webhook-event-id": eventId,
    },
    data: payload,
  });
  expect(secondResponse.ok()).toBeTruthy();
  const second = (await secondResponse.json()) as { duplicate?: boolean; action?: string; reasonCode?: string };
  expect(second.duplicate).toBe(true);
  expect(second.action).toBe("grant");
  expect(second.reasonCode).toBe("replay_duplicate");
});

test("billing webhook marks burst replay duplicates for repeated event-id @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const email = `billing-burst-replay-${Date.now()}@example.com`;
  const providerRef = `pay-burst-${Date.now()}`;
  const eventId = `evt-burst-${Date.now()}`;
  const payload = {
    action: "grant",
    entitlementCode: ENTITLEMENT,
    email,
    provider: "e2e",
    providerRef,
    orderStatus: "paid",
    amountMinor: 110000,
    currency: "RUB",
    source: "e2e-webhook",
  };

  const attemptCount = 6;
  let duplicateCount = 0;

  for (let idx = 0; idx < attemptCount; idx += 1) {
    const response = await request.post("/api/billing/webhook", {
      headers: {
        "x-rr-webhook-secret": WEBHOOK_SECRET,
        "x-rr-webhook-event-id": eventId,
      },
      data: payload,
    });
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { duplicate?: boolean; reasonCode?: string };
    const isDuplicate = body.duplicate === true;
    if (idx === 0) {
      expect(isDuplicate).toBeFalsy();
      expect(body.reasonCode).toBe("processed");
    } else {
      expect(isDuplicate).toBeTruthy();
      expect(body.reasonCode).toBe("replay_duplicate");
      duplicateCount += 1;
    }
  }

  expect(duplicateCount).toBe(attemptCount - 1);
});

test("billing webhook rejects signature timestamp outside allowed window @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const payload = {
    action: "grant",
    entitlementCode: ENTITLEMENT,
    email: `billing-stale-signature-${Date.now()}@example.com`,
    provider: "e2e",
    providerRef: `stale-signature-${Date.now()}`,
  };
  const rawPayload = JSON.stringify(payload);
  const staleTimestampSec = Math.floor(Date.now() / 1000) - 3600;

  const response = await request.post("/api/billing/webhook", {
    headers: createSignatureHeaders(rawPayload, staleTimestampSec),
    data: rawPayload,
  });

  expect(response.status()).toBe(401);
  const body = (await response.json()) as { reasonCode?: string; authMode?: string };
  expect(body.reasonCode).toBe("auth_signature_timestamp_out_of_window");
  expect(body.authMode).toBe("signature");
});

test("billing webhook accepts mixed legacy and signature auth modes @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const sharedEmail = `billing-mixed-auth-${Date.now()}@example.com`;

  const legacyResponse = await request.post("/api/billing/webhook", {
    headers: { "x-rr-webhook-secret": WEBHOOK_SECRET },
    data: {
      action: "grant",
      entitlementCode: ENTITLEMENT,
      email: sharedEmail,
      provider: "e2e",
      providerRef: `mixed-legacy-${Date.now()}`,
      source: "e2e-webhook",
    },
  });
  expect(legacyResponse.ok()).toBeTruthy();
  const legacyBody = (await legacyResponse.json()) as { reasonCode?: string; authMode?: string };
  expect(legacyBody.reasonCode).toBe("processed");
  expect(legacyBody.authMode).toBe("legacy-secret");

  const signaturePayload = {
    action: "grant",
    entitlementCode: ENTITLEMENT,
    email: sharedEmail,
    provider: "e2e",
    providerRef: `mixed-signature-${Date.now()}`,
    source: "e2e-webhook",
  };
  const signatureRaw = JSON.stringify(signaturePayload);
  const signatureTimestampSec = Math.floor(Date.now() / 1000);

  const signatureResponse = await request.post("/api/billing/webhook", {
    headers: createSignatureHeaders(signatureRaw, signatureTimestampSec),
    data: signatureRaw,
  });
  expect(signatureResponse.ok()).toBeTruthy();
  const signatureBody = (await signatureResponse.json()) as { reasonCode?: string; authMode?: string };
  expect(signatureBody.reasonCode).toBe("processed");
  expect(signatureBody.authMode).toBe("signature");

  const mixedHeadersPayload = {
    ...signaturePayload,
    providerRef: `mixed-signature-with-legacy-header-${Date.now()}`,
  };
  const mixedHeadersRaw = JSON.stringify(mixedHeadersPayload);
  const mixedHeadersResponse = await request.post("/api/billing/webhook", {
    headers: {
      ...createSignatureHeaders(mixedHeadersRaw, signatureTimestampSec + 1),
      "x-rr-webhook-secret": "legacy-secret-should-be-ignored-in-signature-mode",
    },
    data: mixedHeadersRaw,
  });
  expect(mixedHeadersResponse.ok()).toBeTruthy();
  const mixedHeadersBody = (await mixedHeadersResponse.json()) as { duplicate?: boolean; reasonCode?: string; authMode?: string };
  expect(mixedHeadersBody.reasonCode).toBe("processed");
  expect(mixedHeadersBody.authMode).toBe("signature");
  expect(mixedHeadersBody.duplicate).toBeFalsy();
});

test("billing webhook blocks signed replay with new timestamp when business event is unchanged @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const email = `billing-signature-replay-${Date.now()}@example.com`;
  const providerRef = `sig-replay-${Date.now()}`;
  const payload = {
    action: "grant",
    entitlementCode: ENTITLEMENT,
    email,
    provider: "e2e",
    providerRef,
    orderStatus: "paid",
    source: "e2e-webhook",
  };
  const rawPayload = JSON.stringify(payload);
  const firstTimestamp = Math.floor(Date.now() / 1000);

  const firstResponse = await request.post("/api/billing/webhook", {
    headers: createSignatureHeaders(rawPayload, firstTimestamp),
    data: rawPayload,
  });
  expect(firstResponse.ok()).toBeTruthy();
  const firstBody = (await firstResponse.json()) as { reasonCode?: string; duplicate?: boolean; authMode?: string };
  expect(firstBody.reasonCode).toBe("processed");
  expect(firstBody.duplicate ?? false).toBeFalsy();
  expect(firstBody.authMode).toBe("signature");

  const secondResponse = await request.post("/api/billing/webhook", {
    headers: createSignatureHeaders(rawPayload, firstTimestamp + 2),
    data: rawPayload,
  });
  expect(secondResponse.ok()).toBeTruthy();
  const secondBody = (await secondResponse.json()) as { reasonCode?: string; duplicate?: boolean; authMode?: string };
  expect(secondBody.reasonCode).toBe("replay_duplicate");
  expect(secondBody.duplicate).toBe(true);
  expect(secondBody.authMode).toBe("signature");
});

test("billing webhook dead-letter does not store secret values from payload @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const providerRef = `deadletter-redaction-${Date.now()}`;
  const secretLikeValue = `very-sensitive-value-${Date.now()}`;
  const beforeRows = readDeadLetterRows().length;

  const response = await request.post("/api/billing/webhook", {
    headers: { "x-rr-webhook-secret": WEBHOOK_SECRET },
    data: {
      action: "invalid-action",
      entitlementCode: ENTITLEMENT,
      provider: "e2e",
      providerRef,
      email: `deadletter-redaction-${Date.now()}@example.com`,
      secret: secretLikeValue,
      token: secretLikeValue,
      signature: secretLikeValue,
    },
  });

  expect(response.status()).toBe(400);
  const body = (await response.json()) as { reasonCode?: string };
  expect(body.reasonCode).toBe("invalid_action");

  const rows = readDeadLetterRows();
  expect(rows.length).toBeGreaterThan(beforeRows);
  const target = [...rows].reverse().find((row) => row.providerRef === providerRef);
  expect(target).toBeTruthy();

  const targetJson = JSON.stringify(target);
  expect(targetJson).not.toContain(secretLikeValue);
  expect(target?.payloadDigest).toBeTruthy();
  expect(typeof target?.payloadBytes).toBe("number");
  expect(Array.isArray(target?.payloadTopLevelKeys)).toBeTruthy();
});

test("billing webhook reconciles donation status transitions by providerRef @critical-contract", async ({ request }) => {
  test.skip(!WEBHOOK_SECRET, "RR_BILLING_WEBHOOK_SECRET is not configured");

  const email = `billing-donation-reconcile-${Date.now()}@example.com`;
  const providerRef = `donate-reconcile-${Date.now()}`;

  const grantResponse = await request.post("/api/billing/webhook", {
    headers: { "x-rr-webhook-secret": WEBHOOK_SECRET },
    data: {
      action: "grant",
      entitlementCode: "donate:supporter",
      email,
      provider: "donate-external",
      providerRef,
      orderStatus: "succeeded",
      amountMinor: 190000,
      currency: "RUB",
      source: "e2e-donate-webhook",
    },
  });
  expect(grantResponse.ok()).toBeTruthy();
  const grantBody = (await grantResponse.json()) as { reasonCode?: string };
  expect(grantBody.reasonCode).toBe("processed");

  const refundResponse = await request.post("/api/billing/webhook", {
    headers: { "x-rr-webhook-secret": WEBHOOK_SECRET },
    data: {
      action: "revoke",
      entitlementCode: "donate:supporter",
      email,
      provider: "donate-external",
      providerRef,
      orderStatus: "refunded",
      amountMinor: 190000,
      currency: "RUB",
      source: "e2e-donate-webhook",
    },
  });
  expect(refundResponse.ok()).toBeTruthy();
  const refundBody = (await refundResponse.json()) as { reasonCode?: string };
  expect(refundBody.reasonCode).toBe("processed");

  const ledgerRaw = readFileSync(DONATIONS_LEDGER_PATH, "utf8");
  const ledger = JSON.parse(ledgerRaw) as {
    records?: Array<{
      provider?: string;
      providerRef?: string;
      status?: string;
      history?: Array<{ status?: string }>;
    }>;
  };
  const record = (ledger.records || []).find(
    (item) => item.provider === "donate-external" && item.providerRef === providerRef
  );
  expect(record).toBeTruthy();
  expect(record?.status).toBe("refunded");
  const historyStatuses = (record?.history || []).map((item) => item.status);
  expect(historyStatuses).toContain("succeeded");
  expect(historyStatuses).toContain("refunded");
});
