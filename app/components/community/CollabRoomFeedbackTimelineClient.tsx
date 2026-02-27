"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

type RoomPayload = {
  id: string;
  title: string;
  description?: string;
  referenceContentType?: "sound" | "article" | "video" | "education";
  referenceContentId?: string;
};

type FeedbackItem = {
  id: string;
  userName: string;
  body: string;
  atMs: number;
  takeId?: string;
  section?: string;
  createdAt: string;
};

type SlotItem = {
  id: string;
  title: string;
  role?: string;
  status: "open" | "filled";
  filledByUserId?: string;
  filledAt?: string;
};

type SlotsResponse = {
  room?: RoomPayload;
  items?: SlotItem[];
};

type FeedbackResponse = {
  room?: RoomPayload;
  items?: FeedbackItem[];
};

const SOUND_DEMO_BY_REFERENCE_ID: Record<string, string> = {
  selezen: "/audio/selezen/selezen-01.mp3",
};

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  const milli = ms % 1000;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

export function CollabRoomFeedbackTimelineClient({ roomId }: { roomId: string }) {
  const { t } = useI18n();
  const [room, setRoom] = useState<RoomPayload | null>(null);
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [status, setStatus] = useState<"loading" | "not_found" | "feedback_error" | "ok">("loading");
  const [slotActionStatus, setSlotActionStatus] = useState("");
  const [takingSlotId, setTakingSlotId] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const demoAudioSrc = useMemo(() => {
    const referenceId = room?.referenceContentId?.trim().toLowerCase() || "";
    return referenceId ? SOUND_DEMO_BY_REFERENCE_ID[referenceId] : undefined;
  }, [room?.referenceContentId]);

  const load = useCallback(async () => {
    const [slotsRes, feedbackRes] = await Promise.all([
      fetch(`/api/community/rooms/${encodeURIComponent(roomId)}/slots`, { cache: "no-store" }),
      fetch(`/api/community/rooms/${encodeURIComponent(roomId)}/feedback?offset=0&limit=200`, { cache: "no-store" }),
    ]);

    if (!slotsRes.ok) {
      setStatus("not_found");
      setRoom(null);
      setSlots([]);
      setItems([]);
      return;
    }

    const slotsPayload = (await slotsRes.json()) as SlotsResponse;
    const nextRoom = slotsPayload.room || null;
    const nextSlots = (slotsPayload.items || []).slice().sort((left, right) => {
      if (left.status !== right.status) return left.status === "open" ? -1 : 1;
      return left.title.localeCompare(right.title);
    });

    if (!feedbackRes.ok) {
      setRoom(nextRoom);
      setSlots(nextSlots);
      setStatus("feedback_error");
      return;
    }

    const feedbackPayload = (await feedbackRes.json()) as FeedbackResponse;
    const roomFromBoth = nextRoom || feedbackPayload.room || null;
    const nextItems = (feedbackPayload.items || []).slice().sort((a, b) => a.atMs - b.atMs);
    setRoom(roomFromBoth);
    setSlots(nextSlots);
    setItems(nextItems);
    setStatus("ok");
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSeek = useCallback((targetMs: number) => {
    const normalized = Math.max(0, Math.floor(targetMs));
    setCurrentMs(normalized);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = normalized / 1000;
    }
  }, []);

  const takeOpenSlot = useCallback(
    async (slotId: string) => {
      setTakingSlotId(slotId);
      try {
        const sourceTakeId = `room-ui-${Date.now()}-${slotId.slice(0, 8)}`;
        const response = await fetch(`/api/community/slots/${encodeURIComponent(slotId)}/take`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceTakeId,
            note: "Room slot CTA",
          }),
        });
        if (response.status === 401) {
          setSlotActionStatus(t("community.feedback.statusTakeAuthRequired"));
          return;
        }
        if (!response.ok) {
          setSlotActionStatus(t("community.feedback.statusTakeFailed"));
          return;
        }
        await load();
        setSlotActionStatus(t("community.feedback.statusTakeSuccess"));
      } finally {
        setTakingSlotId(null);
      }
    },
    [load, t]
  );

  return (
    <section className="rr-article-panel space-y-4 p-4" data-testid="collab-room-feedback-root">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[#e6e8ec]" data-testid="collab-room-title">
          {room?.title || t("community.feedback.defaultRoomTitle")}
        </h1>
        {room?.description ? <p className="text-sm text-[#9aa3b2]">{room.description}</p> : null}
      </header>

      <div className="rounded-md border border-[#2e3e55] bg-[#141c27] p-3">
        <div className="text-xs text-[#8ea7c5]">{t("community.feedback.playbackPosition")}</div>
        <div className="font-mono text-base text-[#d7f2ff]" data-testid="collab-playback-current-ms">
          {currentMs}
        </div>
        <div className="text-xs text-[#8ea7c5]" data-testid="collab-playback-current-label">
          {formatMs(currentMs)}
        </div>
      </div>

      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={demoAudioSrc}
        className="w-full"
        data-testid="collab-room-audio"
      />

      <section className="space-y-2 rounded-md border border-[#2e3e55] bg-[#111826] p-3" data-testid="collab-room-slot-list">
        <div className="text-sm font-medium text-[#dce6f3]">{t("community.feedback.slotsTitle")}</div>
        {slots.length === 0 ? (
          <div className="text-sm text-[#9aa3b2]" data-testid="collab-room-slot-empty">
            {t("community.feedback.slotsEmpty")}
          </div>
        ) : null}
        {slots.map((slot) => (
          <article
            key={slot.id}
            className="rounded-md border border-[#2e3e55] bg-[#141c27] p-2"
            data-testid={`collab-room-slot-item-${slot.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm text-[#e6e8ec]">{slot.title}</div>
                <div className="text-xs text-[#8ea7c5]">
                  {slot.role ? `${slot.role} · ` : ""}
                  {slot.status}
                </div>
              </div>
              {slot.status === "open" ? (
                <button
                  type="button"
                  className="rounded border border-[#3f587b] px-2 py-1 text-xs text-[#d2e7ff] disabled:opacity-60"
                  onClick={() => void takeOpenSlot(slot.id)}
                  disabled={takingSlotId === slot.id}
                  data-testid={`collab-room-slot-take-${slot.id}`}
                >
                  {takingSlotId === slot.id ? t("community.feedback.takeBusy") : t("community.feedback.takeSlot")}
                </button>
              ) : (
                <span className="text-xs text-[#8ea7c5]">{slot.filledByUserId || t("community.feedback.slotFilled")}</span>
              )}
            </div>
          </article>
        ))}
        {slotActionStatus ? (
          <div className="text-xs text-[#9cc4ff]" data-testid="collab-room-slot-action-status">
            {slotActionStatus}
          </div>
        ) : null}
      </section>

      {status !== "ok" ? (
        <div className="text-sm text-[#9aa3b2]" data-testid="collab-room-feedback-status">
          {status === "loading"
            ? t("community.feedback.statusLoadingRoom")
            : status === "not_found"
              ? t("community.feedback.statusRoomNotFound")
              : t("community.feedback.statusLoadCommentsFailed")}
        </div>
      ) : null}

      <div className="space-y-2" data-testid="collab-feedback-list">
        {items.length === 0 ? (
          <div className="text-sm text-[#9aa3b2]" data-testid="collab-feedback-empty">
            {t("community.feedback.empty")}
          </div>
        ) : null}
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-md border border-[#2e3e55] bg-[#111826] p-3"
            data-testid={`collab-feedback-item-${item.id}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded border border-[#3f587b] px-2 py-1 text-xs text-[#d2e7ff] hover:border-[#6f90ba]"
                data-testid={`collab-feedback-marker-btn-${item.id}`}
                onClick={() => handleSeek(item.atMs)}
              >
                {formatMs(item.atMs)}
              </button>
              <span className="text-xs text-[#8ea7c5]">{item.userName}</span>
              {item.section ? <span className="text-xs text-[#7f8ba1]">· {item.section}</span> : null}
            </div>
            <p className="text-sm text-[#e6e8ec]">{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
