"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "../i18n/I18nProvider";

type ThreadSummary = {
  id: string;
  subject: string;
  status: "open" | "closed";
  channel: "general" | "curator";
  contextType: "general" | "course_video" | "course_audio" | "course_text" | "material_offer";
  contextId?: string;
  contextTitle?: string;
  contextSlug?: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
  lastSenderRole: "user" | "admin" | null;
};

type ThreadAttachment = {
  uploadId: string;
  id: string;
  kind: "audio";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
};

type ThreadMessage = {
  id: string;
  senderRole: "user" | "admin";
  senderName: string;
  body: string;
  attachments?: ThreadAttachment[];
  createdAt: string;
};

function formatTime(value: string, locale: "ru" | "en"): string {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default function FeedbackCenterClient() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [subject, setSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [replyMessage, setReplyMessage] = useState("");
  const [newAttachments, setNewAttachments] = useState<ThreadAttachment[]>([]);
  const [replyAttachments, setReplyAttachments] = useState<ThreadAttachment[]>([]);
  const [recordingTarget, setRecordingTarget] = useState<"new" | "reply" | null>(null);
  const [uploadingTarget, setUploadingTarget] = useState<"new" | "reply" | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prefillAppliedRef = useRef(false);

  const activeThread = useMemo(
    () => threads.find((item) => item.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const draftFromQuery = useMemo(() => {
    const subjectParam = searchParams.get("subject")?.trim() || "";
    const channel = searchParams.get("channel") === "curator" ? "curator" : "general";
    const contextType = (() => {
      const raw = searchParams.get("contextType") || "";
      if (raw === "course_video") return "course_video";
      if (raw === "course_audio") return "course_audio";
      if (raw === "course_text") return "course_text";
      if (raw === "material_offer") return "material_offer";
      return "general";
    })();

    return {
      subject: subjectParam,
      channel,
      contextType,
      contextId: searchParams.get("contextId")?.trim() || "",
      contextTitle: searchParams.get("contextTitle")?.trim() || "",
      contextSlug: searchParams.get("contextSlug")?.trim() || "",
    };
  }, [searchParams]);

  useEffect(() => {
    if (prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    if (draftFromQuery.subject) {
      setSubject(draftFromQuery.subject);
    }
  }, [draftFromQuery.subject]);

  const loadThreads = async () => {
    const response = await fetch("/api/feedback/threads", { cache: "no-store" });
    const payload = (await response.json()) as { threads?: ThreadSummary[]; error?: string };
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const nextThreads = payload.threads ?? [];
    setThreads(nextThreads);
    if (!activeThreadId && nextThreads.length) {
      setActiveThreadId(nextThreads[0].id);
    }
  };

  const loadMessages = async (threadId: string) => {
    if (!threadId) return;
    const response = await fetch(`/api/feedback/messages?threadId=${encodeURIComponent(threadId)}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as { messages?: ThreadMessage[]; error?: string };
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    setMessages(payload.messages ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadThreads();
      } catch (error) {
        if (!cancelled) setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeThreadId) {
        setMessages([]);
        return;
      }
      try {
        await loadMessages(activeThreadId);
      } catch (error) {
        if (!cancelled) setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const uploadAudioAttachment = async (file: File, target: "new" | "reply") => {
    if ((target === "new" ? newAttachments.length : replyAttachments.length) >= 3) {
      setStatus(t("feedback.attachmentsLimit"));
      return;
    }

    setUploadingTarget(target);
    try {
      const formData = new FormData();
      formData.set("file", file, file.name || `voice-${Date.now()}.webm`);

      const response = await fetch("/api/feedback/attachments", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { upload?: ThreadAttachment; error?: string };
      if (!response.ok || !payload.upload) throw new Error(payload.error || `HTTP ${response.status}`);
      const uploaded = payload.upload;

      if (target === "new") {
        setNewAttachments((prev) => [...prev, uploaded]);
      } else {
        setReplyAttachments((prev) => [...prev, uploaded]);
      }

      setStatus(t("feedback.attachmentAdded"));
    } catch (error) {
      setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Upload failed"}`);
    } finally {
      setUploadingTarget(null);
    }
  };

  const onAudioFileSelect = async (event: ChangeEvent<HTMLInputElement>, target: "new" | "reply") => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    await uploadAudioAttachment(file, target);
  };

  const startVoiceRecording = async (target: "new" | "reply") => {
    if (recordingTarget) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus(t("feedback.voiceUnsupported"));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onerror = () => {
        setStatus(t("feedback.voiceError"));
      };

      recorder.onstop = async () => {
        const blobType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: blobType });
        const ext = blobType.includes("ogg") ? "ogg" : blobType.includes("wav") ? "wav" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blobType });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        recorderRef.current = null;
        setRecordingTarget(null);
        await uploadAudioAttachment(file, target);
      };

      recorder.start();
      setRecordingTarget(target);
      setStatus(t("feedback.voiceRecording"));
    } catch {
      setStatus(t("feedback.voicePermissionDenied"));
    }
  };

  const stopVoiceRecording = () => {
    if (!recorderRef.current) return;
    if (recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const removeAttachment = (target: "new" | "reply", uploadId: string) => {
    if (target === "new") {
      setNewAttachments((prev) => prev.filter((item) => item.uploadId !== uploadId));
      return;
    }
    setReplyAttachments((prev) => prev.filter((item) => item.uploadId !== uploadId));
  };

  const renderAttachmentComposer = (target: "new" | "reply", attachments: ThreadAttachment[]) => {
    const isRecordingThis = recordingTarget === target;
    const isUploadingThis = uploadingTarget === target;

    return (
      <div className="space-y-2 rounded-sm border border-[#3b3f47] bg-[#1c2027] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-sm border border-[#3b3f47] bg-[#20232b] px-2 py-1 text-xs text-[#e6e8ec] hover:border-[#5f82aa]">
            {t("feedback.attachAudio")}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => void onAudioFileSelect(event, target)}
              data-testid={`feedback-attach-file-${target}`}
              disabled={isUploadingThis}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              if (isRecordingThis) stopVoiceRecording();
              else void startVoiceRecording(target);
            }}
            className={`rounded-sm border px-2 py-1 text-xs ${
              isRecordingThis
                ? "border-[#b84f4f] bg-[#4c2323] text-[#ffb8b8]"
                : "border-[#3b3f47] bg-[#20232b] text-[#e6e8ec] hover:border-[#5f82aa]"
            }`}
            data-testid={`feedback-voice-toggle-${target}`}
            disabled={isUploadingThis || (!!recordingTarget && !isRecordingThis)}
          >
            {isRecordingThis ? t("feedback.voiceStop") : t("feedback.voiceStart")}
          </button>

          {isUploadingThis ? <span className="text-[11px] text-[#9aa3b2]">{t("feedback.uploading")}</span> : null}
          {isRecordingThis ? <span className="text-[11px] text-[#ffb8b8]">{t("feedback.voiceRecording")}</span> : null}
        </div>

        {attachments.length ? (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.uploadId}
                className="rounded-sm border border-[#313641] bg-[#20232b] px-2 py-2"
                data-testid={`feedback-attachment-${target}-${attachment.uploadId}`}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-[#9aa3b2]">
                  <span>{attachment.originalName}</span>
                  <span>{formatBytes(attachment.sizeBytes)}</span>
                </div>
                <audio controls preload="metadata" className="w-full" src={attachment.downloadUrl} />
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => removeAttachment(target, attachment.uploadId)}
                    className="text-[11px] text-[#9cc4ff] underline-offset-4 hover:underline"
                    data-testid={`feedback-remove-attachment-${target}-${attachment.uploadId}`}
                  >
                    {t("feedback.removeAttachment")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-[#7f8ba1]">{t("feedback.attachHint")}</div>
        )}
      </div>
    );
  };

  const createThread = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const subjectValue = String(formData.get("subject") || subject).trim();
    const messageValue = String(formData.get("message") || newMessage).trim();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/feedback/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: subjectValue,
          message: messageValue,
          channel: draftFromQuery.channel,
          contextType: draftFromQuery.contextType,
          contextId: draftFromQuery.contextId,
          contextTitle: draftFromQuery.contextTitle,
          contextSlug: draftFromQuery.contextSlug,
          attachmentIds: newAttachments.map((item) => item.uploadId),
        }),
      });
      const payload = (await response.json()) as { thread?: ThreadSummary; error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setSubject("");
      setNewMessage("");
      setNewAttachments([]);
      await loadThreads();
      if (payload.thread?.id) {
        setActiveThreadId(payload.thread.id);
        await loadMessages(payload.thread.id);
      }
      setStatus(t("feedback.sent"));
    } catch (error) {
      setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeThreadId) return;
    const formData = new FormData(event.currentTarget);
    const replyValue = String(formData.get("replyMessage") || replyMessage).trim();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/feedback/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: activeThreadId,
          message: replyValue,
          attachmentIds: replyAttachments.map((item) => item.uploadId),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setReplyMessage("");
      setReplyAttachments([]);
      await Promise.all([loadThreads(), loadMessages(activeThreadId)]);
      setStatus(t("feedback.sent"));
    } catch (error) {
      setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]" data-testid="feedback-center">
      <section className="rr-article-panel space-y-3 p-4" data-testid="feedback-create">
        <h2 className="text-sm font-semibold text-[#e6e8ec]">{t("feedback.newTitle")}</h2>
        {draftFromQuery.contextTitle ? (
          <div className="rounded-sm border border-[#34506f] bg-[#1d2b3a] px-3 py-2 text-xs text-[#b9d8ff]" data-testid="feedback-context-hint">
            {t("feedback.contextFrom")}: {draftFromQuery.contextTitle}
          </div>
        ) : null}
        <form className="space-y-3" onSubmit={createThread}>
          <input
            name="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t("feedback.subjectPlaceholder")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="feedback-subject-input"
          />
          <textarea
            name="message"
            value={newMessage}
            onChange={(event) => setNewMessage(event.target.value)}
            placeholder={t("feedback.messagePlaceholder")}
            rows={5}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="feedback-message-input"
          />

          {renderAttachmentComposer("new", newAttachments)}

          <button
            type="submit"
            className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy}
            data-testid="feedback-submit"
          >
            {busy ? t("feedback.sending") : t("feedback.send")}
          </button>
        </form>
      </section>

      <section className="space-y-3" data-testid="feedback-threads">
        <div className="rr-article-panel p-3">
          <div className="mb-2 text-sm font-semibold text-[#e6e8ec]">{t("feedback.dialogs")}</div>
          <div className="max-h-[220px] space-y-2 overflow-y-auto">
            {threads.length ? (
              threads.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveThreadId(item.id)}
                  className={`w-full rounded-sm border px-3 py-2 text-left ${
                    item.id === activeThreadId
                      ? "border-[#5f82aa] bg-[#233042]"
                      : "border-[#3b3f47] bg-[#20232b] hover:border-[#5f82aa]"
                  }`}
                  data-testid={`feedback-thread-${item.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[#e6e8ec]">{item.subject}</div>
                    <div className={`text-[11px] ${item.status === "open" ? "text-[#9fe0b5]" : "text-[#f2c58b]"}`}>
                      {item.status === "open" ? t("feedback.statusOpen") : t("feedback.statusClosed")}
                    </div>
                  </div>
                  {item.contextTitle ? <div className="text-[11px] text-[#9cc4ff]">{item.contextTitle}</div> : null}
                  <div className="line-clamp-1 text-xs text-[#9aa3b2]">{item.lastMessagePreview}</div>
                  <div className="text-[11px] text-[#7f8ba1]">
                    {item.messageCount} · {formatTime(item.updatedAt, locale)}
                  </div>
                </button>
              ))
            ) : (
              <div className="text-sm text-[#9aa3b2]">{t("feedback.empty")}</div>
            )}
          </div>
        </div>

        <div className="rr-article-panel space-y-3 p-3" data-testid="feedback-messages">
          <div className="text-sm font-semibold text-[#e6e8ec]">
            {activeThread ? activeThread.subject : t("feedback.dialogTitle")}
          </div>
          <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-sm border border-[#3b3f47] bg-[#1b1f26] p-2">
            {messages.length ? (
              messages.map((item) => (
                <div key={item.id} className="rounded-sm border border-[#313641] bg-[#20232b] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[#d5dbea]">
                      {item.senderName} · {item.senderRole === "admin" ? t("feedback.senderCurator") : t("feedback.senderYou")}
                    </div>
                    <div className="text-[11px] text-[#7f8ba1]">{formatTime(item.createdAt, locale)}</div>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-[#e6e8ec]">{item.body}</div>

                  {item.attachments?.length ? (
                    <div className="mt-2 space-y-2">
                      {item.attachments.map((attachment) => (
                        <div key={attachment.id} className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-2 py-2">
                          <div className="mb-1 text-[11px] text-[#9aa3b2]">
                            {attachment.originalName} · {formatBytes(attachment.sizeBytes)}
                          </div>
                          <audio controls preload="metadata" className="w-full" src={attachment.downloadUrl} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-[#9aa3b2]">{t("feedback.emptyMessages")}</div>
            )}
          </div>

          <form onSubmit={sendReply} className="space-y-2">
            <textarea
              name="replyMessage"
              value={replyMessage}
              onChange={(event) => setReplyMessage(event.target.value)}
              placeholder={t("feedback.replyPlaceholder")}
              rows={3}
              disabled={!activeThread || activeThread.status === "closed"}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none disabled:opacity-60"
              data-testid="feedback-reply-input"
            />

            {renderAttachmentComposer("reply", replyAttachments)}

            <button
              type="submit"
              disabled={busy || !activeThread || activeThread.status === "closed"}
              className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
              data-testid="feedback-reply-submit"
            >
              {busy ? t("feedback.sending") : t("feedback.sendReply")}
            </button>
          </form>

          {status ? (
            <div className="text-xs text-[#9cc4ff]" data-testid="feedback-status">
              {status}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
