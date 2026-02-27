import { NextResponse } from "next/server";
import { listAuthProvidersStatus } from "../../../lib/auth/providers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { providers: listAuthProvidersStatus() },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
