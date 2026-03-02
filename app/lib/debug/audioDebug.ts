"use client";

let debugSessionCounter = 0;

export function createAudioDebugSessionId(prefix = "engine"): string {
  debugSessionCounter += 1;
  return `${prefix}-${debugSessionCounter}`;
}

function isAudioDebugEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_AUDIO_DEBUG === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("rr_audio_debug") === "1";
  } catch {
    return false;
  }
}

export function audioDebug(event: string, payload?: Record<string, unknown>): void {
  if (!isAudioDebugEnabled()) return;
  const ts = new Date().toISOString();
  if (payload && Object.keys(payload).length > 0) {
    console.info(`[AUDIO_DEBUG] ${ts} ${event}`, payload);
    return;
  }
  console.info(`[AUDIO_DEBUG] ${ts} ${event}`);
}
