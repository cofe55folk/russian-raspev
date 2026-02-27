import type { CollabReferenceContentType, CollabRoomRecord, CollabSlotRecord } from "./collab-store";

export type DiscoveryOpenSlotItem = CollabSlotRecord & {
  room?: CollabRoomRecord | null;
};

export type DiscoveryReasonCode =
  | "OPEN_SLOT"
  | "ROOM_ACTIVE"
  | "SLOT_HAS_ROLE"
  | "SLOT_ROLE_EXACT_MATCH"
  | "ROOM_HAS_REFERENCE"
  | "ROOM_REFERENCE_TYPE_MATCH"
  | "ROOM_REFERENCE_ID_MATCH"
  | "SLOT_RECENT_24H"
  | "SLOT_RECENT_7D"
  | "SLOT_OLDER";

export type DiscoveryRankedOpenSlotItem = DiscoveryOpenSlotItem & {
  score: number;
  reasonCodes: DiscoveryReasonCode[];
};

export type DiscoveryRankingInput = {
  role?: string;
  referenceContentType?: CollabReferenceContentType;
  referenceContentId?: string;
  now?: string;
};

function normalize(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function parseDateMs(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function recencyScore(createdAtMs: number, nowMs: number): {
  score: number;
  code: DiscoveryReasonCode;
} {
  const ageMs = Math.max(0, nowMs - createdAtMs);
  const hours = ageMs / (1000 * 60 * 60);
  if (hours <= 24) {
    return { score: 12, code: "SLOT_RECENT_24H" };
  }
  if (hours <= 24 * 7) {
    return { score: 6, code: "SLOT_RECENT_7D" };
  }
  return { score: 1, code: "SLOT_OLDER" };
}

function compareRanked(left: DiscoveryRankedOpenSlotItem, right: DiscoveryRankedOpenSlotItem): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  const leftCreated = parseDateMs(left.createdAt);
  const rightCreated = parseDateMs(right.createdAt);
  if (leftCreated !== rightCreated) {
    return rightCreated - leftCreated;
  }

  const leftUpdated = parseDateMs(left.updatedAt);
  const rightUpdated = parseDateMs(right.updatedAt);
  if (leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated;
  }

  if (left.roomId !== right.roomId) {
    return left.roomId.localeCompare(right.roomId);
  }

  return left.id.localeCompare(right.id);
}

export function rankOpenSlots(
  items: DiscoveryOpenSlotItem[],
  input: DiscoveryRankingInput = {}
): DiscoveryRankedOpenSlotItem[] {
  const roleNeedle = normalize(input.role);
  const typeNeedle = input.referenceContentType;
  const contentNeedle = normalize(input.referenceContentId);
  const nowMs = parseDateMs(input.now) || Date.now();

  const ranked = items
    .filter((item) => item.status === "open")
    .map<DiscoveryRankedOpenSlotItem>((item) => {
      const reasonCodes: DiscoveryReasonCode[] = ["OPEN_SLOT"];
      let score = 10;

      if (item.room?.status === "active") {
        score += 5;
        reasonCodes.push("ROOM_ACTIVE");
      }

      const slotRole = normalize(item.role);
      if (slotRole) {
        score += 8;
        reasonCodes.push("SLOT_HAS_ROLE");
      }
      if (roleNeedle && slotRole && slotRole === roleNeedle) {
        score += 30;
        reasonCodes.push("SLOT_ROLE_EXACT_MATCH");
      }

      if (item.room?.referenceContentType || item.room?.referenceContentId) {
        score += 6;
        reasonCodes.push("ROOM_HAS_REFERENCE");
      }
      if (typeNeedle && item.room?.referenceContentType === typeNeedle) {
        score += 20;
        reasonCodes.push("ROOM_REFERENCE_TYPE_MATCH");
      }

      const slotReferenceId = normalize(item.room?.referenceContentId);
      if (contentNeedle && slotReferenceId && contentNeedle === slotReferenceId) {
        score += 25;
        reasonCodes.push("ROOM_REFERENCE_ID_MATCH");
      }

      const recency = recencyScore(parseDateMs(item.createdAt), nowMs);
      score += recency.score;
      reasonCodes.push(recency.code);

      return {
        ...item,
        score,
        reasonCodes,
      };
    });

  ranked.sort(compareRanked);
  return ranked;
}
