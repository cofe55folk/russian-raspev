import { NextResponse, type NextRequest } from "next/server";
import { readAuthSessionFromRequest } from "../../../../../lib/auth/session";
import { isPreviewFeatureEnabledForRequest } from "../../../../../lib/feature-flags/preview";
import { allowRateLimit } from "../../../../../lib/security/rateLimit";
import { getUgcAssetById, readUgcAssetBytes } from "../../../../../lib/ugc/assets-store-file";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isPreviewFeatureEnabledForRequest(request, "ugc_creator_tracks")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`ugc-assets:stream:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await readAuthSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { assetId } = await context.params;
  const asset = await getUgcAssetById(assetId);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (asset.ownerId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bytes = await readUgcAssetBytes(asset);
  if (!bytes) {
    return NextResponse.json({ error: "Asset file is missing" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": asset.mimeType || "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=0, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
