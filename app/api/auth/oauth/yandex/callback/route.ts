import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { hashPassword } from "../../../../../lib/auth/password";
import { verifyOAuthState } from "../../../../../lib/auth/oauthState";
import { attachAuthSessionCookie, createAuthSessionForUser } from "../../../../../lib/auth/session";
import { findUserByEmail, upsertUserByEmail } from "../../../../../lib/auth/store";

type YandexTokenResponse = {
  access_token?: string;
  token_type?: string;
};

type YandexProfileResponse = {
  default_email?: string;
  emails?: string[];
  login?: string;
  real_name?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
};

function buildRedirectUri(request: NextRequest): string {
  const configured = process.env.RR_AUTH_YANDEX_REDIRECT_URI?.trim();
  if (configured) return configured;
  return new URL("/api/auth/oauth/yandex/callback", request.url).toString();
}

function redirectToAuthWithError(request: NextRequest, reason: string): NextResponse {
  const url = new URL("/auth", request.url);
  url.searchParams.set("oauth_error", reason);
  return NextResponse.redirect(url);
}

function redirectToAccount(request: NextRequest): NextResponse {
  const url = new URL("/account", request.url);
  url.searchParams.set("oauth", "yandex");
  return NextResponse.redirect(url);
}

function pickEmail(profile: YandexProfileResponse): string | null {
  if (typeof profile.default_email === "string" && profile.default_email.trim()) {
    return profile.default_email.trim().toLowerCase();
  }
  if (Array.isArray(profile.emails)) {
    const fromArray = profile.emails.find((item) => typeof item === "string" && item.trim());
    if (fromArray) return fromArray.trim().toLowerCase();
  }
  return null;
}

function pickName(profile: YandexProfileResponse): string | undefined {
  const candidates = [
    profile.real_name,
    profile.display_name,
    [profile.first_name, profile.last_name].filter(Boolean).join(" "),
    profile.login,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.RR_AUTH_YANDEX_CLIENT_ID?.trim();
  const clientSecret = process.env.RR_AUTH_YANDEX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirectToAuthWithError(request, "provider_not_configured");
  }

  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  if (error) {
    return redirectToAuthWithError(request, `provider_error:${error}`);
  }

  const state = searchParams.get("state");
  if (!verifyOAuthState(state, "yandex")) {
    return redirectToAuthWithError(request, "invalid_state");
  }

  const code = searchParams.get("code");
  if (!code) {
    return redirectToAuthWithError(request, "missing_code");
  }

  const redirectUri = buildRedirectUri(request);
  const tokenBody = new URLSearchParams();
  tokenBody.set("grant_type", "authorization_code");
  tokenBody.set("code", code);
  tokenBody.set("client_id", clientId);
  tokenBody.set("client_secret", clientSecret);
  tokenBody.set("redirect_uri", redirectUri);

  const tokenResponse = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: tokenBody.toString(),
    cache: "no-store",
  });
  if (!tokenResponse.ok) {
    return redirectToAuthWithError(request, "token_exchange_failed");
  }

  const tokenPayload = (await tokenResponse.json()) as YandexTokenResponse;
  const accessToken = tokenPayload.access_token?.trim();
  if (!accessToken) {
    return redirectToAuthWithError(request, "missing_access_token");
  }

  const profileResponse = await fetch("https://login.yandex.ru/info?format=json", {
    method: "GET",
    headers: {
      authorization: `OAuth ${accessToken}`,
    },
    cache: "no-store",
  });
  if (!profileResponse.ok) {
    return redirectToAuthWithError(request, "profile_fetch_failed");
  }
  const profile = (await profileResponse.json()) as YandexProfileResponse;
  const email = pickEmail(profile);
  if (!email) {
    return redirectToAuthWithError(request, "missing_email_scope");
  }

  const existingUser = await findUserByEmail(email);
  const user = await upsertUserByEmail({
    email,
    name: pickName(profile),
    passwordHash: existingUser?.passwordHash || hashPassword(randomUUID()),
  });
  const sessionId = await createAuthSessionForUser(user.id);

  const response = redirectToAccount(request);
  attachAuthSessionCookie(response, sessionId);
  return response;
}
