import { promises as fs } from "node:fs";
import path from "node:path";

const GUEST_SYNC_LOG_PATH = path.join(process.cwd(), "data", "analytics", "guest-sync-events.ndjson");

type GuestSyncRow = {
  track_scope_id?: unknown;
  sample_count?: unknown;
  avg_abs_drift_ms?: unknown;
  max_abs_drift_ms?: unknown;
  soft_corrections?: unknown;
  hard_corrections?: unknown;
  ingested_at?: unknown;
};

export type GuestSyncTopTrack = {
  trackScopeId: string;
  reports: number;
  sampleCount: number;
  avgAbsDriftMs: number;
  maxAbsDriftMs: number;
  softCorrections: number;
  hardCorrections: number;
};

export type GuestSyncGlobalSummary = {
  generatedAt: string;
  totalReports: number;
  totalSamples: number;
  avgAbsDriftMs: number;
  maxAbsDriftMs: number;
  softCorrections: number;
  hardCorrections: number;
  topTracks: GuestSyncTopTrack[];
};

function asFinite(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeTrackScopeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 220);
}

export async function getGuestSyncGlobalSummary(): Promise<GuestSyncGlobalSummary> {
  let raw = "";
  try {
    raw = await fs.readFile(GUEST_SYNC_LOG_PATH, "utf8");
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      totalReports: 0,
      totalSamples: 0,
      avgAbsDriftMs: 0,
      maxAbsDriftMs: 0,
      softCorrections: 0,
      hardCorrections: 0,
      topTracks: [],
    };
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const byTrack = new Map<string, GuestSyncTopTrack>();
  let totalReports = 0;
  let totalSamples = 0;
  let weightedAbsDriftTotal = 0;
  let maxAbsDriftMs = 0;
  let softCorrections = 0;
  let hardCorrections = 0;

  for (const line of lines) {
    let parsed: GuestSyncRow;
    try {
      parsed = JSON.parse(line) as GuestSyncRow;
    } catch {
      continue;
    }

    const trackScopeId = normalizeTrackScopeId(parsed.track_scope_id);
    if (!trackScopeId) continue;

    const sampleCount = Math.max(0, Math.floor(asFinite(parsed.sample_count)));
    if (sampleCount <= 0) continue;

    const avgAbsDriftMs = Math.max(0, asFinite(parsed.avg_abs_drift_ms));
    const rowMaxAbsDriftMs = Math.max(0, asFinite(parsed.max_abs_drift_ms));
    const rowSoft = Math.max(0, Math.floor(asFinite(parsed.soft_corrections)));
    const rowHard = Math.max(0, Math.floor(asFinite(parsed.hard_corrections)));

    totalReports += 1;
    totalSamples += sampleCount;
    weightedAbsDriftTotal += avgAbsDriftMs * sampleCount;
    maxAbsDriftMs = Math.max(maxAbsDriftMs, rowMaxAbsDriftMs);
    softCorrections += rowSoft;
    hardCorrections += rowHard;

    const current = byTrack.get(trackScopeId) || {
      trackScopeId,
      reports: 0,
      sampleCount: 0,
      avgAbsDriftMs: 0,
      maxAbsDriftMs: 0,
      softCorrections: 0,
      hardCorrections: 0,
    };

    const nextSampleCount = current.sampleCount + sampleCount;
    const weightedTrackTotal = current.avgAbsDriftMs * current.sampleCount + avgAbsDriftMs * sampleCount;

    current.reports += 1;
    current.sampleCount = nextSampleCount;
    current.avgAbsDriftMs = nextSampleCount > 0 ? Number((weightedTrackTotal / nextSampleCount).toFixed(2)) : 0;
    current.maxAbsDriftMs = Math.max(current.maxAbsDriftMs, rowMaxAbsDriftMs);
    current.softCorrections += rowSoft;
    current.hardCorrections += rowHard;

    byTrack.set(trackScopeId, current);
  }

  const avgAbsDriftMs = totalSamples > 0 ? Number((weightedAbsDriftTotal / totalSamples).toFixed(2)) : 0;
  const topTracks = Array.from(byTrack.values())
    .sort((a, b) => {
      if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
      return b.reports - a.reports;
    })
    .slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    totalReports,
    totalSamples,
    avgAbsDriftMs,
    maxAbsDriftMs: Math.round(maxAbsDriftMs),
    softCorrections,
    hardCorrections,
    topTracks,
  };
}
