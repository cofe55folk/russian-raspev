import { createHash, createHmac, timingSafeEqual } from "crypto";

export type DonateCheckoutInterval = "once" | "monthly";

export type BillingCheckoutCreateParams = {
  amountMinor: number;
  interval: DonateCheckoutInterval;
  returnUrl: URL;
  providerRef: string;
  source: string;
  preferMock?: boolean;
};

export type BillingCheckoutCreateResult = {
  checkoutUrl: string;
  provider: "donate-mock" | "donate-external";
  mode: "mock" | "external";
};

export type BillingWebhookAuthMode = "signature" | "legacy-secret";

export type BillingWebhookAuthResult =
  | {
      ok: true;
      mode: BillingWebhookAuthMode;
      replaySeed: string;
    }
  | {
      ok: false;
      reason: string;
      mode: BillingWebhookAuthMode;
    };

const SIGNATURE_MAX_SKEW_SEC = 10 * 60;
const DEFAULT_PROBE_BACKOFF_MS = [120, 250];

function normalizeCheckoutBaseUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeSecretCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function normalizeSignature(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = trimmed.startsWith("sha256=") ? trimmed.slice(7) : trimmed;
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return value.toLowerCase();
}

function buildMockCheckoutUrl(params: BillingCheckoutCreateParams): string {
  const returnUrl = new URL(params.returnUrl.toString());
  returnUrl.searchParams.set("status", "success");
  returnUrl.searchParams.set("mock", "1");
  returnUrl.searchParams.set("amountMinor", String(params.amountMinor));
  returnUrl.searchParams.set("interval", params.interval);
  returnUrl.searchParams.set("providerRef", params.providerRef);
  return returnUrl.toString();
}

function buildExternalCheckoutUrl(params: BillingCheckoutCreateParams, baseUrl: string): string {
  const providerUrl = new URL(baseUrl);
  providerUrl.searchParams.set("amountMinor", String(params.amountMinor));
  providerUrl.searchParams.set("interval", params.interval);
  providerUrl.searchParams.set("returnUrl", params.returnUrl.toString());
  providerUrl.searchParams.set("source", params.source);
  providerUrl.searchParams.set("providerRef", params.providerRef);
  return providerUrl.toString();
}

export async function createDonateCheckout(params: BillingCheckoutCreateParams): Promise<BillingCheckoutCreateResult> {
  const checkoutBase = normalizeCheckoutBaseUrl(process.env.RR_DONATE_CHECKOUT_URL);
  const useMock = !!params.preferMock || !checkoutBase;
  if (useMock) {
    return {
      checkoutUrl: buildMockCheckoutUrl(params),
      provider: "donate-mock",
      mode: "mock",
    };
  }

  const strictExternalMode = process.env.RR_DONATE_EXTERNAL_STRICT === "1";
  const healthcheckUrl = normalizeCheckoutBaseUrl(process.env.RR_DONATE_CHECKOUT_HEALTHCHECK_URL) || checkoutBase;
  const probeOk = await probeProviderWithRetry({
    url: healthcheckUrl,
  });
  if (!probeOk && !strictExternalMode) {
    return {
      checkoutUrl: buildMockCheckoutUrl(params),
      provider: "donate-mock",
      mode: "mock",
    };
  }
  if (!probeOk && strictExternalMode) {
    throw new Error("checkout_provider_unavailable");
  }

  return {
    checkoutUrl: buildExternalCheckoutUrl(params, checkoutBase),
    provider: "donate-external",
    mode: "external",
  };
}

export async function probeProviderWithRetry(params: {
  url: string;
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number[];
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const attempts = Number.isFinite(params.attempts) ? Math.max(1, Math.floor(params.attempts ?? 1)) : 3;
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(50, Math.floor(params.timeoutMs ?? 700)) : 700;
  const backoffMs = (params.backoffMs ?? DEFAULT_PROBE_BACKOFF_MS).map((item) =>
    Number.isFinite(item) ? Math.max(0, Math.floor(item)) : 0
  );
  const fetchImpl = params.fetchImpl ?? fetch;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(params.url, {
        method: "HEAD",
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.ok) return true;
    } catch {
      // retry path
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts - 1) {
      const waitMs = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  return false;
}

export function verifyBillingWebhookAuth(params: {
  headers: Headers;
  rawPayload: string;
  secret: string;
}): BillingWebhookAuthResult {
  const signatureRaw = params.headers.get("x-rr-webhook-signature")?.trim() || "";
  const timestampRaw = params.headers.get("x-rr-webhook-timestamp")?.trim() || "";

  if (signatureRaw || timestampRaw) {
    const signature = normalizeSignature(signatureRaw);
    if (!signature) {
      return { ok: false, reason: "invalid_signature_format", mode: "signature" };
    }
    const timestampSec = Number(timestampRaw);
    if (!Number.isFinite(timestampSec) || timestampSec <= 0) {
      return { ok: false, reason: "invalid_signature_timestamp", mode: "signature" };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - Math.floor(timestampSec)) > SIGNATURE_MAX_SKEW_SEC) {
      return { ok: false, reason: "signature_timestamp_out_of_window", mode: "signature" };
    }

    const signedPayload = `${Math.floor(timestampSec)}.${params.rawPayload}`;
    const expected = createHmac("sha256", params.secret).update(signedPayload).digest("hex");
    if (!safeSecretCompare(signature, expected)) {
      return { ok: false, reason: "signature_mismatch", mode: "signature" };
    }
    return {
      ok: true,
      mode: "signature",
      replaySeed: `sig:${Math.floor(timestampSec)}:${signature}`,
    };
  }

  const legacySecret = params.headers.get("x-rr-webhook-secret")?.trim() || "";
  if (!legacySecret || !safeSecretCompare(legacySecret, params.secret)) {
    return { ok: false, reason: "legacy_secret_mismatch", mode: "legacy-secret" };
  }
  const payloadHash = createHash("sha256").update(params.rawPayload).digest("hex");
  return {
    ok: true,
    mode: "legacy-secret",
    replaySeed: `legacy:${payloadHash}`,
  };
}
