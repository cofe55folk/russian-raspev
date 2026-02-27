import { NextResponse } from "next/server";
import {
  createNotationInteropError,
  summarizeNotationImport,
  validateNotationImport,
} from "../../../lib/notation/interop";
import { persistIdempotencyResult, resolveIdempotency } from "../../../lib/security/idempotency";

type ImportPayload = {
  format?: unknown;
  content?: unknown;
};

export async function POST(request: Request) {
  let payload: ImportPayload;
  try {
    payload = (await request.json()) as ImportPayload;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: createNotationInteropError("invalid_json", "Request body must be valid JSON."),
      },
      { status: 400 }
    );
  }

  const idempotencyScope = "notation.import.post";
  const idempotency = await resolveIdempotency({
    scope: idempotencyScope,
    idempotencyKeyHeader: request.headers.get("idempotency-key"),
    payload,
  });
  if (!idempotency.ok) {
    const details =
      idempotency.error === "INVALID_IDEMPOTENCY_KEY"
        ? { field: "Idempotency-Key", reason: "invalid_format" }
        : { field: "Idempotency-Key", reason: "payload_mismatch" };
    return NextResponse.json(
      {
        ok: false,
        error: createNotationInteropError("invalid_payload", "Idempotency-Key validation failed.", details),
      },
      { status: idempotency.error === "INVALID_IDEMPOTENCY_KEY" ? 422 : 409 }
    );
  }
  if (idempotency.mode === "replay") {
    return NextResponse.json(idempotency.responseBody, { status: idempotency.responseStatus });
  }

  const respond = async (status: number, body: unknown) => {
    if (idempotency.mode === "new") {
      await persistIdempotencyResult({
        scope: idempotencyScope,
        resolved: idempotency,
        responseStatus: status,
        responseBody: body,
      });
    }
    return NextResponse.json(body, { status });
  };

  const result = validateNotationImport(payload);
  if (!result.ok) {
    return respond(result.status, {
      ok: false,
      error: result.error,
    });
  }

  return respond(200, {
    ok: true,
    data: {
      summary: summarizeNotationImport(result.data),
    },
  });
}
