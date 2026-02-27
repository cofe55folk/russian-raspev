export const MINI_PLAYER_ACTIONS = [
  "controller_handoff",
  "panel_collapse",
  "panel_expand",
  "queue_jump",
  "queue_next",
  "queue_prev",
  "seek_commit",
  "toggle_loop",
  "toggle_pause",
  "toggle_play",
  "track_end",
  "track_loop_restart",
  "transport_recovered",
  "transport_retry",
  "transport_stalled",
] as const;

export type MiniPlayerAction = (typeof MINI_PLAYER_ACTIONS)[number];

export const MINI_PLAYER_END_STREAM_REASONS = [
  "loop_restart",
  "next_track",
  "playlist_jump",
  "previous_track",
  "resume",
  "retry_recovered",
  "retrying",
  "seek",
  "source_handoff",
  "stalled",
  "track_ended",
  "user_pause",
] as const;

export type MiniPlayerEndStreamReason = (typeof MINI_PLAYER_END_STREAM_REASONS)[number];

const ACTION_SET = new Set<string>(MINI_PLAYER_ACTIONS);
const END_REASON_SET = new Set<string>(MINI_PLAYER_END_STREAM_REASONS);

export function isMiniPlayerAction(value: string): value is MiniPlayerAction {
  return ACTION_SET.has(value);
}

export function isMiniPlayerEndStreamReason(value: string): value is MiniPlayerEndStreamReason {
  return END_REASON_SET.has(value);
}
