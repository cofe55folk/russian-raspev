import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const session = await readAuthSessionFromRequest(request);
  return NextResponse.json(
    { session },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
