import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type AdminAnalyticsErrorResponse = {
  error: string;
  code: "UNAUTHORIZED" | "RATE_LIMITED" | "ADMIN_SECRET_NOT_CONFIGURED";
  status: 401 | 429 | 503;
};

const SEARCH_QUALITY_RATE_LIMIT = 120;
const SEARCH_EXPORT_RATE_LIMIT = 60;

function expectAdminErrorFormat(payload: unknown, expectedStatus: 401 | 429 | 503): asserts payload is AdminAnalyticsErrorResponse {
  expect(payload).toMatchObject({
    error: expect.any(String),
    code: expect.any(String),
    status: expectedStatus,
  });
}

async function hitUntilRateLimited(request: APIRequestContext, path: string, limit: number): Promise<APIResponse> {
  const ip = `198.51.102.${Date.now()}`;
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

test("admin search quality API returns consistent 401/503 error format @admin-analytics-contract", async ({ request }) => {
  const response = await request.get("/api/admin/analytics/search-quality");
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

test("admin search quality export API returns consistent 401/503 error format @admin-analytics-contract", async ({ request }) => {
  const response = await request.get("/api/admin/analytics/search-quality/export");
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

test("admin search quality API rate-limit returns consistent 429 error format @admin-analytics-contract", async ({ request }) => {
  const response = await hitUntilRateLimited(request, "/api/admin/analytics/search-quality", SEARCH_QUALITY_RATE_LIMIT);
  expect(response.status()).toBe(429);

  const payload = (await response.json()) as unknown;
  expectAdminErrorFormat(payload, 429);
  expect(payload.code).toBe("RATE_LIMITED");
  expect(payload.error).toBe("Too many requests");
});

test("admin search quality export API rate-limit returns consistent 429 error format @admin-analytics-contract", async ({ request }) => {
  const response = await hitUntilRateLimited(
    request,
    "/api/admin/analytics/search-quality/export",
    SEARCH_EXPORT_RATE_LIMIT
  );
  expect(response.status()).toBe(429);

  const payload = (await response.json()) as unknown;
  expectAdminErrorFormat(payload, 429);
  expect(payload.code).toBe("RATE_LIMITED");
  expect(payload.error).toBe("Too many requests");
});

test("admin search quality export returns csv headers and content rows @admin-analytics-contract", async ({ request }) => {
  const adminSecret = process.env.RR_ADMIN_API_SECRET?.trim();
  test.skip(!adminSecret, "RR_ADMIN_API_SECRET is required for successful CSV export contract checks");

  const uniqueQuery = `zzzxqv-admin-export-${Date.now()}`;

  const seedResponse = await request.get(`/api/search/suggest?q=${encodeURIComponent(uniqueQuery)}&limit=8&locale=ru`);
  expect(seedResponse.ok()).toBeTruthy();

  const response = await request.get("/api/admin/analytics/search-quality/export?limit=200&locale=ru", {
    headers: {
      "x-rr-admin-secret": adminSecret!,
    },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv; charset=utf-8");
  expect(response.headers()["content-disposition"]).toContain('attachment; filename="search-failed-queries-ru.csv"');
  expect(response.headers()["cache-control"]).toBe("no-store");

  const csv = await response.text();
  const lines = csv.trim().split("\n");

  expect(lines[0]).toBe("query,total_count,zero_result_count,zero_result_rate");
  expect(lines.length).toBeGreaterThan(1);

  const matchingRow = lines.find((line) => line.includes(`"${uniqueQuery}"`));
  expect(matchingRow).toBeTruthy();
  expect(matchingRow).toMatch(/^".+",\d+,\d+,\d+\.\d{4}$/);
});
