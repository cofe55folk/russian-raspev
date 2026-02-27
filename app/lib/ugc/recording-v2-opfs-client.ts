"use client";

export type RecordingV2OpfsAppendResult = {
  seq: number;
  bytesWritten: number;
  totalBytes: number;
  chunkCount: number;
};

export type RecordingV2OpfsFinalizeResult = {
  takeId: string;
  byteLength: number;
  chunkCount: number;
  blob: Blob;
};

export type RecordingV2OpfsWriter = {
  takeId: string;
  supported: boolean;
  appendChunk: (chunk: Blob, seq: number) => Promise<RecordingV2OpfsAppendResult>;
  finalizeToBlob: (mimeType: string) => Promise<RecordingV2OpfsFinalizeResult>;
  close: () => Promise<void>;
};

type WorkerOk<T extends object = object> = { ok: true } & T;
type WorkerErr = { ok: false; error: string };
type WorkerResponse<T extends object = object> = WorkerOk<T> | WorkerErr;

type WorkerCallPayload = {
  type: "init" | "append" | "finalize" | "close";
  takeId?: string;
  seq?: number;
  buffer?: ArrayBuffer;
};

const OPFS_WORKER_URL = "/workers/recording-v2-opfs-writer.js";

function opfsSupportedInWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof Worker === "undefined") return false;
  const navWithStorage = navigator as Navigator & { storage?: { getDirectory?: () => Promise<unknown> } };
  return typeof navWithStorage.storage?.getDirectory === "function";
}

function createWorkerCallBridge(worker: Worker) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: WorkerResponse<object>) => void; reject: (reason?: unknown) => void }>();

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data as { id?: number } & WorkerResponse<object>;
    if (!message || typeof message.id !== "number") return;
    const slot = pending.get(message.id);
    if (!slot) return;
    pending.delete(message.id);
    slot.resolve(message);
  };

  worker.onerror = (event) => {
    const reason = event?.message || "OPFS_WORKER_ERROR";
    for (const slot of pending.values()) {
      slot.reject(new Error(reason));
    }
    pending.clear();
  };

  const call = <T extends object>(payload: WorkerCallPayload, transfer: Transferable[] = []): Promise<WorkerResponse<T>> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: WorkerResponse<object>) => void, reject });
      try {
        worker.postMessage({ id, ...payload }, transfer);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  };

  return { call };
}

export async function createRecordingV2OpfsWriter(takeId: string): Promise<RecordingV2OpfsWriter | null> {
  if (!opfsSupportedInWindow()) return null;
  const normalizedTakeId = takeId.trim();
  if (!normalizedTakeId) return null;

  const worker = new Worker(OPFS_WORKER_URL);
  const bridge = createWorkerCallBridge(worker);

  const init = await bridge.call<{ supported?: boolean; takeId?: string }>({
    type: "init",
    takeId: normalizedTakeId,
  });
  if (!init.ok || !init.supported) {
    try {
      worker.terminate();
    } catch {}
    return null;
  }

  const appendChunk = async (chunk: Blob, seq: number): Promise<RecordingV2OpfsAppendResult> => {
    const buffer = await chunk.arrayBuffer();
    const result = await bridge.call<{
      seq?: number;
      bytesWritten?: number;
      totalBytes?: number;
      chunkCount?: number;
    }>(
      {
        type: "append",
        seq: Math.max(0, Math.floor(seq)),
        buffer,
      },
      [buffer]
    );
    if (!result.ok) throw new Error(result.error || "OPFS_APPEND_FAILED");
    return {
      seq: typeof result.seq === "number" ? Math.max(0, Math.floor(result.seq)) : seq,
      bytesWritten: typeof result.bytesWritten === "number" ? Math.max(0, Math.floor(result.bytesWritten)) : chunk.size,
      totalBytes: typeof result.totalBytes === "number" ? Math.max(0, Math.floor(result.totalBytes)) : chunk.size,
      chunkCount: typeof result.chunkCount === "number" ? Math.max(0, Math.floor(result.chunkCount)) : 0,
    };
  };

  const finalizeToBlob = async (mimeType: string): Promise<RecordingV2OpfsFinalizeResult> => {
    const result = await bridge.call<{
      takeId?: string;
      byteLength?: number;
      chunkCount?: number;
      buffer?: ArrayBuffer;
    }>({
      type: "finalize",
    });
    if (!result.ok) throw new Error(result.error || "OPFS_FINALIZE_FAILED");
    const data = result.buffer instanceof ArrayBuffer ? result.buffer : new ArrayBuffer(0);
    return {
      takeId: typeof result.takeId === "string" && result.takeId ? result.takeId : normalizedTakeId,
      byteLength: typeof result.byteLength === "number" ? Math.max(0, Math.floor(result.byteLength)) : data.byteLength,
      chunkCount: typeof result.chunkCount === "number" ? Math.max(0, Math.floor(result.chunkCount)) : 0,
      blob: new Blob([data], { type: mimeType || "application/octet-stream" }),
    };
  };

  const close = async () => {
    try {
      await bridge.call({ type: "close" });
    } catch {
      // ignore close failures
    } finally {
      try {
        worker.terminate();
      } catch {}
    }
  };

  return {
    takeId: normalizedTakeId,
    supported: true,
    appendChunk,
    finalizeToBlob,
    close,
  };
}
