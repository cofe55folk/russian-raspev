import {
  listCollabFeedbackByRoom,
  listCollabRooms,
  listCollabSlotsByRoom,
  type CollabFeedbackRecord,
  type CollabRoomRecord,
} from "./collab-store";

export type CollabSummarySnapshot = {
  room_completed_per_week: number;
  conversion_to_slot_fill: number;
  slot_fill_rate: number;
  time_to_first_timed_comment: number;
};

const ROOM_PAGE_LIMIT = 200;
const FEEDBACK_PAGE_LIMIT = 200;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function listAllRooms() {
  const rooms: CollabRoomRecord[] = [];
  let offset = 0;
  while (true) {
    const page = await listCollabRooms({
      offset,
      limit: ROOM_PAGE_LIMIT,
    });
    rooms.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) break;
  }
  return rooms;
}

async function listAllFeedbackByRoom(roomId: string) {
  const feedbacks: CollabFeedbackRecord[] = [];
  let offset = 0;
  while (true) {
    const page = await listCollabFeedbackByRoom({
      roomId,
      offset,
      limit: FEEDBACK_PAGE_LIMIT,
    });
    feedbacks.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) break;
  }
  return feedbacks;
}

export async function getCollabSummarySnapshot(now: Date = new Date()): Promise<CollabSummarySnapshot> {
  const rooms = await listAllRooms();
  if (rooms.length === 0) {
    return {
      room_completed_per_week: 0,
      conversion_to_slot_fill: 0,
      slot_fill_rate: 0,
      time_to_first_timed_comment: 0,
    };
  }

  const weekAgoMs = now.getTime() - WEEK_MS;
  let totalSlots = 0;
  let totalFilledSlots = 0;
  let roomsWithFilledSlots = 0;
  let completedRoomsInWeek = 0;
  const firstTimedCommentMs: number[] = [];

  for (const room of rooms) {
    const slots = await listCollabSlotsByRoom(room.id);
    const filledSlots = slots.filter((slot) => slot.status === "filled");
    totalSlots += slots.length;
    totalFilledSlots += filledSlots.length;

    if (filledSlots.length > 0) {
      roomsWithFilledSlots += 1;
    }

    if (slots.length > 0 && filledSlots.length === slots.length) {
      const completionCandidates = filledSlots
        .map((slot) => Date.parse(slot.filledAt || ""))
        .filter((value) => Number.isFinite(value));
      const completionMs =
        completionCandidates.length > 0
          ? Math.max(...completionCandidates)
          : Date.parse(room.updatedAt || room.createdAt || "");
      if (Number.isFinite(completionMs) && completionMs >= weekAgoMs) {
        completedRoomsInWeek += 1;
      }
    }

    const feedbacks = await listAllFeedbackByRoom(room.id);
    const timedCandidates = feedbacks
      .map((item) => item.atMs)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    if (timedCandidates.length > 0) {
      firstTimedCommentMs.push(timedCandidates[0]);
    }
  }

  const conversionToSlotFill = rooms.length > 0 ? roundRate(roomsWithFilledSlots / rooms.length) : 0;
  const slotFillRate = totalSlots > 0 ? roundRate(totalFilledSlots / totalSlots) : 0;
  const timeToFirstTimedComment =
    firstTimedCommentMs.length > 0
      ? Math.round(firstTimedCommentMs.reduce((sum, value) => sum + value, 0) / firstTimedCommentMs.length)
      : 0;

  return {
    room_completed_per_week: completedRoomsInWeek,
    conversion_to_slot_fill: conversionToSlotFill,
    slot_fill_rate: slotFillRate,
    time_to_first_timed_comment: timeToFirstTimedComment,
  };
}
