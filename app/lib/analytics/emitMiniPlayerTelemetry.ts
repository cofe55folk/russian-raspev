"use client";

import {
  isMiniPlayerAction,
  isMiniPlayerEndStreamReason,
  type MiniPlayerAction,
  type MiniPlayerEndStreamReason,
} from "./miniplayerContract";

type MiniPlayerTelemetryPayload = {
  controllerId: string;
  action: MiniPlayerAction;
  endStreamReason?: MiniPlayerEndStreamReason;
  playing?: boolean;
  currentSec?: number;
  durationSec?: number;
  loopOn?: boolean;
  playlistIndex?: number;
  route?: string;
  locale?: string;
};

const TELEMETRY_QUEUE_KEY = "rr_miniplayer_telemetry_queue_v1";
const TELEMETRY_QUEUE_MAX = 80;
const MINIPLAYER_TELEMETRY_PERSIST_IN_DEV = process.env.NEXT_PUBLIC_MINIPLAYER_TELEMETRY_PERSIST === "1";
let flushQueueInFlight = false;
let onlineFlushListenerBound = false;

function normalizeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, limit);
}

function normalizeFinite(value: unknown, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(max, Number(num.toFixed(3))));
}

function normalizeInt(value: unknown, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(max, Math.floor(num)));
}

function readQueue(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TELEMETRY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeQueue(items: string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (!items.length) {
      window.localStorage.removeItem(TELEMETRY_QUEUE_KEY);
      return;
    }
    window.localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items.slice(-TELEMETRY_QUEUE_MAX)));
  } catch {}
}

function enqueueTelemetry(json: string): void {
  const queue = readQueue();
  queue.push(json);
  writeQueue(queue);
}

function ensureOnlineFlushListener(): void {
  if (typeof window === "undefined") return;
  if (onlineFlushListenerBound) return;
  window.addEventListener("online", () => {
    void flushQueuedTelemetry();
  });
  onlineFlushListenerBound = true;
}

async function flushQueuedTelemetry(): Promise<void> {
  if (flushQueueInFlight) return;
  flushQueueInFlight = true;
  try {
    const queue = readQueue();
    if (!queue.length) return;
    const pending: string[] = [];
    for (let i = 0; i < queue.length; i += 1) {
      const body = queue[i]!;
      try {
        const response = await fetch("/api/analytics/miniplayer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        });
        if (!response.ok) {
          pending.push(body);
        }
      } catch {
        pending.push(body);
      }
      if (pending.length) {
        // Keep order and avoid hammering while offline or degraded.
        pending.push(...queue.slice(i + 1));
        break;
      }
    }
    writeQueue(pending);
  } finally {
    flushQueueInFlight = false;
  }
}

export function emitMiniPlayerTelemetry(payload: MiniPlayerTelemetryPayload): void {
  const shouldPersist = process.env.NODE_ENV === "production" || MINIPLAYER_TELEMETRY_PERSIST_IN_DEV;
  if (!shouldPersist) return;

  const controllerId = normalizeText(payload.controllerId, 120);
  const action = normalizeText(payload.action, 64);
  if (!controllerId || !action || !isMiniPlayerAction(action)) return;
  const endStreamReason = normalizeText(payload.endStreamReason, 64);
  const safeEndStreamReason = endStreamReason && isMiniPlayerEndStreamReason(endStreamReason) ? endStreamReason : "";

  const body = {
    controllerId,
    action,
    endStreamReason: safeEndStreamReason,
    playing: !!payload.playing,
    currentSec: normalizeFinite(payload.currentSec, 60 * 60 * 8),
    durationSec: normalizeFinite(payload.durationSec, 60 * 60 * 8),
    loopOn: !!payload.loopOn,
    playlistIndex: normalizeInt(payload.playlistIndex, 5000),
    route: normalizeText(payload.route, 220) || (typeof window !== "undefined" ? window.location.pathname : ""),
    locale: normalizeText(payload.locale, 8) || (typeof document !== "undefined" ? document.documentElement.lang.slice(0, 2) : ""),
    userAgent: normalizeText(typeof navigator !== "undefined" ? navigator.userAgent : "", 220),
  };

  const json = JSON.stringify(body);
  ensureOnlineFlushListener();
  void flushQueuedTelemetry();

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueueTelemetry(json);
    return;
  }

  // sendBeacon is best-effort and may report success while offline.
  // Restrict it to hidden-page delivery; foreground flow uses fetch + queue fallback.
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden" &&
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    try {
      const blob = new Blob([json], { type: "application/json" });
      const sent = navigator.sendBeacon("/api/analytics/miniplayer", blob);
      if (sent) return;
    } catch {
      // fallback below
    }
  }

  void fetch("/api/analytics/miniplayer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: json,
    keepalive: true,
  })
    .then((response) => {
      if (response.ok) return;
      enqueueTelemetry(json);
    })
    .catch(() => {
      enqueueTelemetry(json);
    });
}
