"use client";

import { useEffect, useState } from "react";
import PageHero from "../../components/PageHero";
import { useI18n } from "../../components/i18n/I18nProvider";
import { readAdminSecretClient, writeAdminSecretClient } from "../../lib/admin/clientSecret";

type AdminAction = "grant" | "revoke";

type ApiResponse = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

function formatJson(value: unknown): string {
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    return String(value);
  }
}

export default function AdminEntitlementsPage() {
  const { t } = useI18n();
  const [secret, setSecret] = useState("");
  const [action, setAction] = useState<AdminAction>("grant");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("course:porushka-foundation:access");
  const [expiresAt, setExpiresAt] = useState("");
  const [source, setSource] = useState("admin-ui");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    setSecret(readAdminSecretClient());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeAdminSecretClient(secret);
  }, [secret, hydrated]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    setResult("");
    try {
      const response = await fetch("/api/admin/entitlements", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rr-admin-secret": secret,
        },
        body: JSON.stringify({
          action,
          userId: userId.trim() || undefined,
          email: email.trim() || undefined,
          name: name.trim() || undefined,
          code: code.trim() || undefined,
          expiresAt: expiresAt.trim() || undefined,
          source: source.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as ApiResponse;
      setResult(formatJson(payload));
      if (!response.ok) {
        setStatus(`${t("admin.entitlements.error")}: ${payload.error || `HTTP ${response.status}`}`);
        return;
      }
      setStatus(t("admin.entitlements.result"));
    } catch (error) {
      setStatus(`${t("admin.entitlements.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="rr-main">
      <PageHero title={t("admin.entitlements.pageTitle")} subtitle={t("admin.entitlements.pageSubtitle")} />
      <section className="rr-container mt-8 max-w-3xl">
        <form onSubmit={onSubmit} className="rr-article-panel space-y-4 p-5" data-testid="admin-entitlements-form">
          <div className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-xs text-[#9aa3b2]">
            {t("admin.entitlements.hint")}
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.secret")}</span>
            <input
              data-testid="admin-secret-input"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              type="password"
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.action")}</span>
            <select
              data-testid="admin-action-select"
              value={action}
              onChange={(event) => setAction(event.target.value as AdminAction)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            >
              <option value="grant">{t("admin.entitlements.action.grant")}</option>
              <option value="revoke">{t("admin.entitlements.action.revoke")}</option>
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.userId")}</span>
              <input
                data-testid="admin-userid-input"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.email")}</span>
              <input
                data-testid="admin-email-input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.name")}</span>
              <input
                data-testid="admin-name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.code")}</span>
              <input
                data-testid="admin-code-input"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.expiresAt")}</span>
              <input
                data-testid="admin-expires-input"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                placeholder="2026-12-31T23:59:59.000Z"
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("admin.entitlements.source")}</span>
              <input
                data-testid="admin-source-input"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !hydrated}
              data-testid="admin-submit"
              className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? t("admin.entitlements.pending") : t("admin.entitlements.submit")}
            </button>
            {status ? (
              <span className="text-xs text-[#9cc4ff]" data-testid="admin-status">
                {status}
              </span>
            ) : null}
          </div>

          {result ? (
            <pre
              className="max-h-[360px] overflow-auto rounded-sm border border-[#3b3f47] bg-[#161a20] p-3 text-xs text-[#d5dbea]"
              data-testid="admin-result"
            >
              {result}
            </pre>
          ) : null}
        </form>
      </section>
    </main>
  );
}
