"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { getPublicProfileHref } from "../../lib/i18n/routing";

type RingStyle = "none" | "sky" | "emerald" | "gold";

type ProfilePayload = {
  profile?: {
    displayName?: string;
    handle?: string;
    bio?: string;
    visibility?: "private" | "public";
    avatarUrl?: string;
    ringStyle?: RingStyle;
    updatedAt?: string | null;
  };
  premiumRings?: boolean;
  error?: string;
};

function ringClass(style: RingStyle): string {
  if (style === "gold") return "border-[#d6b25e]";
  if (style === "emerald") return "border-[#42a06f]";
  if (style === "sky") return "border-[#5f82aa]";
  return "border-[#3b3f47]";
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] || "";
  const second = parts[1]?.[0] || "";
  return `${first}${second}`.toUpperCase();
}

export default function ProfileSettingsClient() {
  const { locale, t } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [ringStyle, setRingStyle] = useState<RingStyle>("none");
  const [premiumRings, setPremiumRings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/community/profile", { cache: "no-store" });
        const payload = (await response.json()) as ProfilePayload;
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (cancelled) return;
        setDisplayName(payload.profile?.displayName || "");
        setHandle(payload.profile?.handle || "");
        setBio(payload.profile?.bio || "");
        setVisibility(payload.profile?.visibility === "public" ? "public" : "private");
        setAvatarUrl(payload.profile?.avatarUrl || "");
        setRingStyle(payload.profile?.ringStyle || "none");
        setPremiumRings(payload.premiumRings === true);
      } catch (error) {
        if (!cancelled) {
          setStatus(`${t("profile.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/community/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          handle,
          bio,
          visibility,
          avatarUrl,
          ringStyle,
        }),
      });
      const payload = (await response.json()) as ProfilePayload;
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setDisplayName(payload.profile?.displayName || "");
      setHandle(payload.profile?.handle || "");
      setBio(payload.profile?.bio || "");
      setVisibility(payload.profile?.visibility === "public" ? "public" : "private");
      setAvatarUrl(payload.profile?.avatarUrl || "");
      setRingStyle(payload.profile?.ringStyle || "none");
      setPremiumRings(payload.premiumRings === true);
      setStatus(t("profile.saved"));
    } catch (error) {
      setStatus(`${t("profile.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-sm border border-[#3b3f47] bg-[#20232b] p-4" data-testid="profile-settings">
      <div className="text-sm font-semibold text-[#e6e8ec]">{t("profile.title")}</div>

      <div className="flex items-center gap-3">
        <div className={`h-14 w-14 overflow-hidden rounded-full border-2 ${ringClass(ringStyle)}`}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={displayName || t("profile.previewAlt")} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#2b303a] text-sm font-semibold text-[#d5dbea]">
              {initialsFromName(displayName || t("profile.previewAlt"))}
            </div>
          )}
        </div>
        <div className="text-xs text-[#9aa3b2]">{t("profile.previewHint")}</div>
      </div>

      <form className="space-y-3" onSubmit={onSave}>
        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("profile.displayName")}</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder={t("profile.displayNamePlaceholder")}
            data-testid="profile-display-name"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("profile.handle")}</span>
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder={t("profile.handlePlaceholder")}
            data-testid="profile-handle"
          />
          <div className="text-[11px] text-[#7f8ba1]">{t("profile.handleHint")}</div>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("profile.bio")}</span>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={3}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder={t("profile.bioPlaceholder")}
            data-testid="profile-bio"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("profile.visibility")}</span>
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value === "public" ? "public" : "private")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="profile-visibility"
          >
            <option value="private">{t("profile.visibility.private")}</option>
            <option value="public">{t("profile.visibility.public")}</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("profile.avatarUrl")}</span>
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder="https://..."
            data-testid="profile-avatar-url"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("profile.ringStyle")}</span>
          <select
            value={ringStyle}
            onChange={(event) => setRingStyle(event.target.value as RingStyle)}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="profile-ring-style"
          >
            <option value="none">{t("profile.ring.none")}</option>
            <option value="sky" disabled={!premiumRings}>
              {t("profile.ring.sky")}
            </option>
            <option value="emerald" disabled={!premiumRings}>
              {t("profile.ring.emerald")}
            </option>
            <option value="gold" disabled={!premiumRings}>
              {t("profile.ring.gold")}
            </option>
          </select>
        </label>

        {!premiumRings ? <div className="text-xs text-[#f2c58b]">{t("profile.premiumHint")}</div> : null}

        {visibility === "public" && handle.trim() ? (
          <a
            href={getPublicProfileHref(locale, handle)}
            className="inline-block text-xs text-[#9cc4ff] hover:underline"
            data-testid="profile-public-link"
          >
            {t("profile.openPublicProfile")}
          </a>
        ) : null}

        <button
          type="submit"
          className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
          disabled={busy}
          data-testid="profile-save"
        >
          {busy ? t("profile.saving") : t("profile.save")}
        </button>
      </form>

      {status ? (
        <div className="text-xs text-[#9cc4ff]" data-testid="profile-status">
          {status}
        </div>
      ) : null}
    </section>
  );
}
