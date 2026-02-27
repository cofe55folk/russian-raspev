import { NextResponse, type NextRequest } from "next/server";
import { issueOAuthState } from "../../../../../lib/auth/oauthState";

function buildRedirectUri(request: NextRequest): string {
  const configured = process.env.RR_AUTH_YANDEX_REDIRECT_URI?.trim();
  if (configured) return configured;
  return new URL("/api/auth/oauth/yandex/callback", request.url).toString();
}

export async function GET(request: NextRequest) {
  const clientId = process.env.RR_AUTH_YANDEX_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json({ error: "Yandex OAuth is not configured" }, { status: 500 });
  }

  const redirectUri = buildRedirectUri(request);
  const state = issueOAuthState("yandex");
  const authorizeUrl = new URL("https://oauth.yandex.ru/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.redirect(authorizeUrl);
}
