import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { hashPassword } from "../../../../../lib/auth/password";
import { verifyOAuthState } from "../../../../../lib/auth/oauthState";
import { attachAuthSessionCookie, createAuthSessionForUser } from "../../../../../lib/auth/session";
import { findUserByEmail, upsertUserByEmail } from "../../../../../lib/auth/store";

const VK_PKCE_COOKIE = "rr_vk_pkce_v1";

type VkTokenResponse = {
  access_token?: string;
  user_id?: number | string;
  email?: string;
  device_id?: string;
  error?: string;
  error_description?: string;
};

type VkUserResponse = {
  response?: Array<{
    id?: number;
    first_name?: string;
    last_name?: string;
    screen_name?: string;
  }>;
  error?: {
    error_msg?: string;
  };
};

function buildRedirectUri(request: NextRequest): string {
  const configured = process.env.RR_AUTH_VK_REDIRECT_URI?.trim();
  if (configured) return configured;
  return new URL("/api/auth/oauth/vk/callback", request.url).toString();
}

function redirectToAuthWithError(request: NextRequest, reason: string): NextResponse {
  const url = new URL("/auth", request.url);
  url.searchParams.set("oauth_error", reason);
  return NextResponse.redirect(url);
}

function redirectToAccount(request: NextRequest): NextResponse {
  const url = new URL("/account", request.url);
  url.searchParams.set("oauth", "vk");
  return NextResponse.redirect(url);
}

function getVkTokenUrl(): URL {
  const configured = process.env.RR_AUTH_VK_TOKEN_URL?.trim();
  return new URL(configured || "https://id.vk.com/oauth2/auth");
}

function getVkApiMethodBase(): string {
  const configured = process.env.RR_AUTH_VK_API_BASE_URL?.trim();
  return (configured || "https://api.vk.ru/method").replace(/\/$/, "");
}

function parseUserId(payload: VkTokenResponse): string {
  if (typeof payload.user_id === "number" && Number.isFinite(payload.user_id)) return String(payload.user_id);
  if (typeof payload.user_id === "string" && payload.user_id.trim()) return payload.user_id.trim();
  return "";
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function pickName(profile: VkUserResponse): string | undefined {
  const first = profile.response?.[0];
  if (!first) return undefined;
  const full = [first.first_name, first.last_name].filter((part): part is string => !!part && !!part.trim()).join(" ");
  if (full) return full;
  if (typeof first.screen_name === "string" && first.screen_name.trim()) return first.screen_name.trim();
  return undefined;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.RR_AUTH_VK_CLIENT_ID?.trim();
  const clientSecret = process.env.RR_AUTH_VK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirectToAuthWithError(request, "provider_not_configured");
  }

  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  if (error) {
    return redirectToAuthWithError(request, `provider_error:${error}`);
  }

  const state = searchParams.get("state");
  if (!verifyOAuthState(state, "vk")) {
    return redirectToAuthWithError(request, "invalid_state");
  }

  const code = searchParams.get("code");
  if (!code) {
    return redirectToAuthWithError(request, "missing_code");
  }

  const redirectUri = buildRedirectUri(request);
  if (!isAbsoluteHttpUrl(redirectUri)) {
    return redirectToAuthWithError(request, "invalid_redirect_uri");
  }
  const codeVerifier = request.cookies.get(VK_PKCE_COOKIE)?.value?.trim();
  if (!codeVerifier) {
    return redirectToAuthWithError(request, "missing_pkce_verifier");
  }
  const deviceId = searchParams.get("device_id")?.trim() || "";
  const tokenUrl = getVkTokenUrl();
  const tokenBody = new URLSearchParams();
  tokenBody.set("grant_type", "authorization_code");
  tokenBody.set("client_id", clientId);
  tokenBody.set("client_secret", clientSecret);
  tokenBody.set("redirect_uri", redirectUri);
  tokenBody.set("code", code);
  tokenBody.set("code_verifier", codeVerifier);
  if (deviceId) tokenBody.set("device_id", deviceId);

  let tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: tokenBody.toString(),
    cache: "no-store",
  });
  if (!tokenResponse.ok) {
    // Fallback for older VK OAuth contracts.
    const fallbackUrl = new URL("https://oauth.vk.ru/access_token");
    fallbackUrl.searchParams.set("client_id", clientId);
    fallbackUrl.searchParams.set("client_secret", clientSecret);
    fallbackUrl.searchParams.set("redirect_uri", redirectUri);
    fallbackUrl.searchParams.set("code", code);
    tokenResponse = await fetch(fallbackUrl, {
      method: "GET",
      cache: "no-store",
    });
  }
  if (!tokenResponse.ok) {
    return redirectToAuthWithError(request, "token_exchange_failed");
  }

  const tokenPayload = (await tokenResponse.json()) as VkTokenResponse;
  if (tokenPayload.error) {
    return redirectToAuthWithError(request, `token_error:${tokenPayload.error}`);
  }

  const accessToken = tokenPayload.access_token?.trim();
  if (!accessToken) {
    return redirectToAuthWithError(request, "missing_access_token");
  }

  const userId = parseUserId(tokenPayload);
  if (!userId) {
    return redirectToAuthWithError(request, "missing_user_id");
  }

  const apiVersion = process.env.RR_AUTH_VK_API_VERSION?.trim() || "5.199";
  const email = tokenPayload.email?.trim().toLowerCase() || `vk-${userId}@oauth.local`;

  const usersUrl = new URL(`${getVkApiMethodBase()}/users.get`);
  usersUrl.searchParams.set("user_ids", userId);
  usersUrl.searchParams.set("access_token", accessToken);
  usersUrl.searchParams.set("v", apiVersion);

  let userName: string | undefined;
  try {
    const profileResponse = await fetch(usersUrl, {
      method: "GET",
      cache: "no-store",
    });
    if (profileResponse.ok) {
      const profilePayload = (await profileResponse.json()) as VkUserResponse;
      userName = pickName(profilePayload);
    }
  } catch {}

  const existingUser = await findUserByEmail(email);
  const user = await upsertUserByEmail({
    email,
    name: userName,
    passwordHash: existingUser?.passwordHash || hashPassword(randomUUID()),
  });
  const sessionId = await createAuthSessionForUser(user.id);

  const response = redirectToAccount(request);
  response.cookies.set(VK_PKCE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/oauth/vk/callback",
    maxAge: 0,
  });
  attachAuthSessionCookie(response, sessionId);
  return response;
}
