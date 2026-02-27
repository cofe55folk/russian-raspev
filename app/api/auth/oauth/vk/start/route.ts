import { NextResponse, type NextRequest } from "next/server";
import { issueOAuthState } from "../../../../../lib/auth/oauthState";
import { generatePkceChallenge, generatePkceVerifier } from "../../../../../lib/auth/pkce";

const VK_PKCE_COOKIE = "rr_vk_pkce_v1";

function buildRedirectUri(request: NextRequest): string {
  const configured = process.env.RR_AUTH_VK_REDIRECT_URI?.trim();
  if (configured) return configured;
  return new URL("/api/auth/oauth/vk/callback", request.url).toString();
}

function buildVkAuthorizeUrl(): URL {
  const configured = process.env.RR_AUTH_VK_AUTHORIZE_URL?.trim();
  return new URL(configured || "https://id.vk.com/authorize");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const clientId = process.env.RR_AUTH_VK_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json({ error: "VK OAuth is not configured" }, { status: 500 });
  }

  const redirectUri = buildRedirectUri(request);
  if (!isAbsoluteHttpUrl(redirectUri)) {
    return NextResponse.json({ error: "Invalid RR_AUTH_VK_REDIRECT_URI" }, { status: 500 });
  }
  const state = issueOAuthState("vk");
  const scope = process.env.RR_AUTH_VK_SCOPE?.trim() || "email";
  const apiVersion = process.env.RR_AUTH_VK_API_VERSION?.trim() || "5.199";
  const pkceVerifier = generatePkceVerifier();
  const pkceChallenge = generatePkceChallenge(pkceVerifier);

  const authorizeUrl = buildVkAuthorizeUrl();
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", pkceChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (scope) authorizeUrl.searchParams.set("scope", scope);
  if (apiVersion) authorizeUrl.searchParams.set("v", apiVersion);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(VK_PKCE_COOKIE, pkceVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/oauth/vk/callback",
    maxAge: 60 * 10,
  });
  return response;
}
