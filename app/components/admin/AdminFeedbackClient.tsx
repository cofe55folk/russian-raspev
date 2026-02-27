"use client";

import { useEffect, useMemo, useState } from "react";
import { readAdminSecretClient, writeAdminSecretClient } from "../../lib/admin/clientSecret";
import { useI18n } from "../i18n/I18nProvider";

type ThreadSummary = {
  id: string;
  userEmail: string;
  userName?: string;
  subject: string;
  status: "open" | "closed";
  channel: "general" | "curator";
  contextType: "general" | "course_video" | "course_audio" | "course_text" | "material_offer";
  contextTitle?: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
};

type ThreadAttachment = {
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

export default function AdminFeedbackClient() {
  const { locale, t } = useI18n();
  const [secret, setSecret] = useState("");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [secretReady, setSecretReady] = useState(false);

  useEffect(() => {
    setSecret(readAdminSecretClient());
    setSecretReady(true);
  }, []);

  useEffect(() => {
    if (!secretReady) return;
    writeAdminSecretClient(secret);
  }, [secret, secretReady]);

  const activeThread = useMemo(
    () => threads.find((item) => item.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const withAdminSecret = (url: string): string => {
    const safeSecret = secret.trim();
    if (!safeSecret) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}adminSecret=${encodeURIComponent(safeSecret)}`;
  };

  const loadThreads = async () => {
    const response = await fetch("/api/admin/feedback/threads", {
      headers: { "x-rr-admin-secret": secret },
      cache: "no-store",
    });
    const payload = (await response.json()) as { threads?: ThreadSummary[]; error?: string };
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const nextThreads = payload.threads ?? [];
    setThreads(nextThreads);
    if (!activeThreadId && nextThreads.length) setActiveThreadId(nextThreads[0].id);
  };

  const loadMessages = async (threadId: string) => {
    if (!threadId) return;
    const response = await fetch(`/api/admin/feedback/messages?threadId=${encodeURIComponent(threadId)}`, {
      headers: { "x-rr-admin-secret": secret },
      cache: "no-store",
    });
    const payload = (await response.json()) as { messages?: ThreadMessage[]; error?: string };
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    setMessages(payload.messages ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeThreadId || !secret) {
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

  const onLoad = async () => {
    setBusy(true);
    setStatus("");
    try {
      await loadThreads();
      setStatus(t("admin.feedback.loaded"));
    } catch (error) {
      setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const onSendReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeThreadId) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/admin/feedback/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rr-admin-secret": secret,
        },
        body: JSON.stringify({
          threadId: activeThreadId,
          message: replyText,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setReplyText("");
      await Promise.all([loadThreads(), loadMessages(activeThreadId)]);
      setStatus(t("feedback.sent"));
    } catch (error) {
      setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const setThreadStatus = async (nextStatus: "open" | "closed") => {
    if (!activeThreadId) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/admin/feedback/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rr-admin-secret": secret,
        },
        body: JSON.stringify({
          threadId: activeThreadId,
          status: nextStatus,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await loadThreads();
      setStatus(t("admin.feedback.statusUpdated"));
    } catch (error) {
      setStatus(`${t("feedback.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-feedback-root">
      <div className="rr-article-panel space-y-3 p-4" data-testid="admin-feedback-auth">
        <div className="text-sm text-[#9aa3b2]">{t("admin.feedback.secretHint")}</div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            type="password"
            className="w-full max-w-sm rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder={t("admin.entitlements.secret")}
            data-testid="admin-feedback-secret-input"
          />
          <button
            type="button"
            onClick={onLoad}
            className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy || !secret.trim()}
            data-testid="admin-feedback-load"
          >
            {busy ? t("feedback.sending") : t("admin.feedback.load")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rr-article-panel p-3" data-testid="admin-feedback-threads">
          <div className="mb-2 text-sm font-semibold text-[#e6e8ec]">{t("feedback.dialogs")}</div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
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
                  data-testid={`admin-feedback-thread-${item.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[#e6e8ec]">{item.userName || item.userEmail}</div>
                    <div className={`text-[11px] ${item.status === "open" ? "text-[#9fe0b5]" : "text-[#f2c58b]"}`}>
                      {item.status === "open" ? t("feedback.statusOpen") : t("feedback.statusClosed")}
                    </div>
                  </div>
                  <div className="text-xs text-[#9aa3b2]">{item.subject}</div>
                  {item.contextTitle ? <div className="text-[11px] text-[#9cc4ff]">{item.contextTitle}</div> : null}
                  <div className="line-clamp-1 text-xs text-[#7f8ba1]">{item.lastMessagePreview}</div>
                  <div className="text-[11px] text-[#7f8ba1]">
                    {item.messageCount} · {formatTime(item.updatedAt, locale)}
                  </div>
                </button>
              ))
            ) : (
              <div className="text-sm text-[#9aa3b2]">{t("feedback.empty")}</div>
            )}
          </div>
        </section>

        <section className="rr-article-panel space-y-3 p-3" data-testid="admin-feedback-dialog">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[#e6e8ec]">
              {activeThread ? activeThread.subject : t("feedback.dialogTitle")}
            </div>
            {activeThread ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setThreadStatus("open")}
                  disabled={busy}
                  className="rounded-sm border border-[#2d6b43] bg-[#163827] px-2 py-1 text-xs text-[#9fe0b5] disabled:opacity-60"
                  data-testid="admin-feedback-open-thread"
                >
                  {t("admin.feedback.openThread")}
                </button>
                <button
                  type="button"
                  onClick={() => setThreadStatus("closed")}
                  disabled={busy}
                  className="rounded-sm border border-[#6b4d2d] bg-[#3a2b1b] px-2 py-1 text-xs text-[#ffdca8] disabled:opacity-60"
                  data-testid="admin-feedback-close-thread"
                >
                  {t("admin.feedback.closeThread")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-sm border border-[#3b3f47] bg-[#1b1f26] p-2">
            {messages.length ? (
              messages.map((item) => (
                <div key={item.id} className="rounded-sm border border-[#313641] bg-[#20232b] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[#d5dbea]">
                      {item.senderName} · {item.senderRole === "admin" ? t("feedback.senderCurator") : t("feedback.senderUser")}
                    </div>
                    <div className="text-[11px] text-[#7f8ba1]">{formatTime(item.createdAt, locale)}</div>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-[#e6e8ec]">{item.body}</div>
                  {item.attachments?.length ? (
                    <div className="mt-2 space-y-2">
                      {item.attachments.map((attachment) => (
                        <div key={attachment.id} className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-2 py-2">
                          <div className="mb-1 text-[11px] text-[#9aa3b2]">
                            {attachment.originalName} · {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
                          </div>
                          <audio controls preload="metadata" className="w-full" src={withAdminSecret(attachment.downloadUrl)} />
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

          <form className="space-y-2" onSubmit={onSendReply}>
            <textarea
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              rows={4}
              placeholder={t("admin.feedback.replyPlaceholder")}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="admin-feedback-reply-input"
            />
            <button
              type="submit"
              disabled={busy || !activeThread}
              className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
              data-testid="admin-feedback-reply-submit"
            >
              {busy ? t("feedback.sending") : t("admin.feedback.reply")}
            </button>
          </form>
        </section>
      </div>

      {status ? (
        <div className="text-xs text-[#9cc4ff]" data-testid="admin-feedback-status">
          {status}
        </div>
      ) : null}
    </div>
  );
}
