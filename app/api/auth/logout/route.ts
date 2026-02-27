import { NextResponse, type NextRequest } from "next/server";
import {
  clearAuthSessionCookie,
  revokeAuthSessionFromRequest,
} from "../../../lib/auth/session";

export async function POST(request: NextRequest) {
  await revokeAuthSessionFromRequest(request);
  const response = NextResponse.json({ ok: true });
  clearAuthSessionCookie(response);
  return response;
}
