import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type AdminAnalyticsErrorResponse = {
  error: string;
  code: "UNAUTHORIZED" | "RATE_LIMITED" | "ADMIN_SECRET_NOT_CONFIGURED";
  status: 401 | 429 | 503;
};

const GUEST_SYNC_RATE_LIMIT = 120;

function expectAdminErrorFormat(payload: unknown, expectedStatus: 401 | 429 | 503): asserts payload is AdminAnalyticsErrorResponse {
  expect(payload).toMatchObject({
    error: expect.any(String),
    code: expect.any(String),
    status: expectedStatus,
  });
}

async function hitUntilRateLimited(request: APIRequestContext, path: string, limit: number): Promise<APIResponse> {
  const ip = `198.51.103.${Date.now()}`;
  let rateLimitedResponse: APIResponse | null = null;

  for (let index = 0; index < limit + 5; index += 1) {
    const response = await request.get(path, {
      headers: {
        "x-forwarded-for": ip,
      },
    });
    if (response.status() === 429) {
      rateLimitedResponse = response;
      break;
    }
  }

  expect(rateLimitedResponse, `Expected 429 for ${path}`).not.toBeNull();
  return rateLimitedResponse as APIResponse;
}

test("admin guest sync summary API returns consistent 401/503 error format @admin-analytics-contract", async ({ request }) => {
  const response = await request.get("/api/admin/analytics/guest-sync-summary");
  expect([401, 503]).toContain(response.status());

  const payload = (await response.json()) as unknown;
  expectAdminErrorFormat(payload, response.status() as 401 | 503);
  if (response.status() === 401) {
    expect(payload.code).toBe("UNAUTHORIZED");
    expect(payload.error).toBe("Unauthorized");
  } else {
    expect(payload.code).toBe("ADMIN_SECRET_NOT_CONFIGURED");
    expect(payload.error).toBe("Admin API secret is not configured");
  }
});

test("admin guest sync summary API rate-limit returns consistent 429 error format @admin-analytics-contract", async ({ request }) => {
  const response = await hitUntilRateLimited(request, "/api/admin/analytics/guest-sync-summary", GUEST_SYNC_RATE_LIMIT);
  expect(response.status()).toBe(429);

  const payload = (await response.json()) as unknown;
  expectAdminErrorFormat(payload, 429);
  expect(payload.code).toBe("RATE_LIMITED");
  expect(payload.error).toBe("Too many requests");
});
