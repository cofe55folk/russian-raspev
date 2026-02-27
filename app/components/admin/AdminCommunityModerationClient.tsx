"use client";

import { useEffect, useState } from "react";
import { readAdminSecretClient, writeAdminSecretClient } from "../../lib/admin/clientSecret";
import { useI18n } from "../i18n/I18nProvider";

type ModerationAction = "hideComment" | "showComment" | "setUserRestriction";

export default function AdminCommunityModerationClient() {
  const { t } = useI18n();
  const [secret, setSecret] = useState("");
  const [action, setAction] = useState<ModerationAction>("setUserRestriction");
  const [commentId, setCommentId] = useState("");
  const [userId, setUserId] = useState("");
  const [canComment, setCanComment] = useState(true);
  const [linksAllowed, setLinksAllowed] = useState(false);
  const [cooldown, setCooldown] = useState(15);
  const [bannedUntil, setBannedUntil] = useState("");
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

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/admin/community/moderation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rr-admin-secret": secret,
        },
        body: JSON.stringify({
          action,
          commentId: commentId.trim() || undefined,
          userId: userId.trim() || undefined,
          canComment,
          linksAllowed,
          commentCooldownSec: cooldown,
          bannedUntil: bannedUntil.trim() || undefined,
          source: "admin-community-ui",
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(`${t("comments.error")}: ${payload.error || `HTTP ${response.status}`}`);
        return;
      }
      setStatus(t("admin.community.saved"));
    } catch (error) {
      setStatus(`${t("comments.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="rr-article-panel space-y-4 p-5" onSubmit={onSubmit} data-testid="admin-community-form">
      <div className="text-sm text-[#9aa3b2]">{t("admin.community.hint")}</div>
      <input
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        placeholder={t("admin.entitlements.secret")}
        className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
        data-testid="admin-community-secret"
      />
      <select
        value={action}
        onChange={(event) => setAction(event.target.value as ModerationAction)}
        className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
        data-testid="admin-community-action"
      >
        <option value="setUserRestriction">{t("admin.community.action.restrictUser")}</option>
        <option value="hideComment">{t("admin.community.action.hideComment")}</option>
        <option value="showComment">{t("admin.community.action.showComment")}</option>
      </select>

      {action === "setUserRestriction" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder={t("admin.community.userId")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-community-userid"
          />
          <input
            value={bannedUntil}
            onChange={(event) => setBannedUntil(event.target.value)}
            placeholder="2026-12-31T23:59:59.000Z"
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-community-banned-until"
          />
          <label className="flex items-center gap-2 text-sm text-[#d5dbea]">
            <input type="checkbox" checked={canComment} onChange={(e) => setCanComment(e.target.checked)} />
            {t("admin.community.canComment")}
          </label>
          <label className="flex items-center gap-2 text-sm text-[#d5dbea]">
            <input type="checkbox" checked={linksAllowed} onChange={(e) => setLinksAllowed(e.target.checked)} />
            {t("admin.community.linksAllowed")}
          </label>
          <input
            type="number"
            min={0}
            max={3600}
            value={cooldown}
            onChange={(e) => setCooldown(Number(e.target.value))}
            placeholder={t("admin.community.cooldownSec")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-community-cooldown"
          />
        </div>
      ) : (
        <input
          value={commentId}
          onChange={(event) => setCommentId(event.target.value)}
          placeholder={t("admin.community.commentId")}
          className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
          data-testid="admin-community-commentid"
        />
      )}

      <button
        type="submit"
        disabled={busy}
        className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
        data-testid="admin-community-submit"
      >
        {busy ? t("comments.sending") : t("admin.entitlements.submit")}
      </button>
      {status ? (
        <div className="text-xs text-[#9cc4ff]" data-testid="admin-community-status">
          {status}
        </div>
      ) : null}
    </form>
  );
}
