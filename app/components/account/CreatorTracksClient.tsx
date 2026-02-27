"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

type TrackVisibility = "private" | "unlisted" | "public";
type TrackStatus = "draft" | "published";
type StemAccessTier = "free" | "premium";
type StemAlignStatus = "pending" | "aligned" | "needs_review";
type StemAlignMethod = "manual" | "rms_correlation" | "transient_anchor";

type TrackStem = {
  id: string;
  label: string;
  accessTier: StemAccessTier;
  sortOrder: number;
  assetUploadId?: string;
  assetMimeType?: string;
  assetSizeBytes?: number;
  referenceStemId?: string;
  alignmentOffsetMs?: number;
  alignmentScore?: number;
  alignmentStatus: StemAlignStatus;
  alignmentMethod?: StemAlignMethod;
  alignmentMeasuredAt?: string;
};

type TrackRecord = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  visibility: TrackVisibility;
  status: TrackStatus;
  stems: TrackStem[];
  updatedAt: string;
};

type TracksPayload = {
  tracks?: TrackRecord[];
  error?: string;
};

type UploadAssetPayload = {
  ok?: boolean;
  error?: string;
  asset?: {
    id?: string;
    uploadId?: string;
  };
};

function parseStemsInput(value: string): Array<{ label: string; accessTier: StemAccessTier; sortOrder: number }> {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24);
  return lines.map((line, index) => {
    const [labelRaw, tierRaw] = line.split("|");
    const label = (labelRaw || "").trim().slice(0, 120);
    const tier = (tierRaw || "").trim().toLowerCase();
    return {
      label,
      accessTier: tier === "premium" ? "premium" : "free",
      sortOrder: index,
    };
  });
}

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

function formatBytes(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatOffsetMs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} ms`;
}

function formatAlignmentScore(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export default function CreatorTracksClient() {
  const { locale, t } = useI18n();
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [visibility, setVisibility] = useState<TrackVisibility>("private");
  const [publishNow, setPublishNow] = useState(false);
  const [stemsDraft, setStemsDraft] = useState("");
  const [attachTrackId, setAttachTrackId] = useState("");
  const [attachLabel, setAttachLabel] = useState("");
  const [attachTier, setAttachTier] = useState<StemAccessTier>("free");
  const [attachReferenceStemId, setAttachReferenceStemId] = useState("");
  const [attachAlignmentMethod, setAttachAlignmentMethod] = useState<StemAlignMethod>("manual");
  const [attachAlignmentStatus, setAttachAlignmentStatus] = useState<StemAlignStatus>("pending");
  const [attachAlignmentOffsetMs, setAttachAlignmentOffsetMs] = useState("");
  const [attachAlignmentScore, setAttachAlignmentScore] = useState("");
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [recomputeStemId, setRecomputeStemId] = useState("");
  const attachFileRef = useRef<HTMLInputElement | null>(null);

  const selectedAttachTrack = tracks.find((track) => track.id === attachTrackId);

  useEffect(() => {
    if (!selectedAttachTrack || !selectedAttachTrack.stems.length) {
      setAttachReferenceStemId("");
      return;
    }
    if (!selectedAttachTrack.stems.some((stem) => stem.id === attachReferenceStemId)) {
      setAttachReferenceStemId(selectedAttachTrack.stems[0].id);
    }
  }, [selectedAttachTrack, attachReferenceStemId]);

  const loadTracks = async () => {
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/ugc/tracks", { cache: "no-store" });
      const payload = (await response.json()) as TracksPayload;
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setTracks(payload.tracks || []);
    } catch (error) {
      setStatus(`${t("creatorTracks.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTracks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const stems = parseStemsInput(stemsDraft);
      const response = await fetch("/api/ugc/tracks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          title,
          subtitle,
          visibility,
          status: publishNow ? "published" : "draft",
          stems,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

      setSlug("");
      setTitle("");
      setSubtitle("");
      setVisibility("private");
      setPublishNow(false);
      setStemsDraft("");
      setStatus(t("creatorTracks.saved"));
      await loadTracks();
    } catch (error) {
      setStatus(`${t("creatorTracks.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const onAttachStem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!attachTrackId || !attachLabel.trim() || !attachFile) {
      setStatus(t("creatorTracks.attachMissing"));
      return;
    }

    setAttachBusy(true);
    setStatus("");
    try {
      const uploadBody = new FormData();
      uploadBody.set("file", attachFile);
      const uploadResponse = await fetch("/api/ugc/assets/upload", {
        method: "POST",
        body: uploadBody,
      });
      const uploadPayload = (await uploadResponse.json()) as UploadAssetPayload;
      if (!uploadResponse.ok) throw new Error(uploadPayload.error || `HTTP ${uploadResponse.status}`);

      const assetUploadId = uploadPayload.asset?.uploadId || uploadPayload.asset?.id;
      if (!assetUploadId) throw new Error("Missing uploaded asset id");

      const attachResponse = await fetch(`/api/ugc/tracks/${encodeURIComponent(attachTrackId)}/stems`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: attachLabel,
          accessTier: attachTier,
          assetUploadId,
          referenceStemId: attachReferenceStemId || undefined,
          alignmentMethod: attachAlignmentMethod,
          alignmentStatus: attachAlignmentStatus,
          alignmentOffsetMs:
            attachAlignmentOffsetMs.trim() !== "" && Number.isFinite(Number(attachAlignmentOffsetMs))
              ? Math.max(-5000, Math.min(5000, Math.round(Number(attachAlignmentOffsetMs))))
              : undefined,
          alignmentScore:
            attachAlignmentScore.trim() !== "" && Number.isFinite(Number(attachAlignmentScore))
              ? Math.max(0, Math.min(1, Number(attachAlignmentScore)))
              : undefined,
          alignmentMeasuredAt: new Date().toISOString(),
        }),
      });
      const attachPayload = (await attachResponse.json()) as { error?: string };
      if (!attachResponse.ok) throw new Error(attachPayload.error || `HTTP ${attachResponse.status}`);

      setAttachLabel("");
      setAttachTier("free");
      setAttachAlignmentMethod("manual");
      setAttachAlignmentStatus("pending");
      setAttachAlignmentOffsetMs("");
      setAttachAlignmentScore("");
      setAttachFile(null);
      if (attachFileRef.current) attachFileRef.current.value = "";
      setStatus(t("creatorTracks.attachSaved"));
      await loadTracks();
    } catch (error) {
      setStatus(`${t("creatorTracks.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setAttachBusy(false);
    }
  };

  const onRecomputeStemAlignment = async (
    trackId: string,
    stemId: string,
    referenceStemId?: string
  ) => {
    setRecomputeStemId(stemId);
    setStatus("");
    try {
      const response = await fetch(
        `/api/ugc/tracks/${encodeURIComponent(trackId)}/stems/${encodeURIComponent(stemId)}/recompute-align`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ referenceStemId }),
        }
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setStatus(t("creatorTracks.recomputeSaved"));
      await loadTracks();
    } catch (error) {
      setStatus(
        `${t("creatorTracks.error")}: ${error instanceof Error ? error.message : t("creatorTracks.recomputeError")}`
      );
    } finally {
      setRecomputeStemId("");
    }
  };

  return (
    <section className="space-y-3 rounded-sm border border-[#3b3f47] bg-[#20232b] p-4" data-testid="creator-tracks">
      <div className="text-sm font-semibold text-[#e6e8ec]">{t("creatorTracks.title")}</div>
      <div className="text-xs text-[#9aa3b2]">{t("creatorTracks.hint")}</div>

      <form className="space-y-3 rounded-sm border border-[#3b3f47] bg-[#1b1f26] p-3" onSubmit={onCreate}>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.slug")}</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              placeholder="my-track-slug"
              data-testid="creator-track-slug"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.titleField")}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              placeholder={t("creatorTracks.titlePlaceholder")}
              data-testid="creator-track-title"
            />
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachReferenceStem")}</span>
            <select
              value={attachReferenceStemId}
              onChange={(event) => setAttachReferenceStemId(event.target.value)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="creator-attach-reference-stem"
            >
              <option value="">{t("creatorTracks.attachReferenceStemNone")}</option>
              {(selectedAttachTrack?.stems || [])
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((stem) => (
                  <option key={stem.id} value={stem.id}>
                    {stem.label}
                  </option>
                ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachAlignmentMethod")}</span>
            <select
              value={attachAlignmentMethod}
              onChange={(event) => setAttachAlignmentMethod(event.target.value as StemAlignMethod)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="creator-attach-alignment-method"
            >
              <option value="manual">{t("creatorTracks.alignMethod.manual")}</option>
              <option value="rms_correlation">{t("creatorTracks.alignMethod.rmsCorrelation")}</option>
              <option value="transient_anchor">{t("creatorTracks.alignMethod.transientAnchor")}</option>
            </select>
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachAlignmentStatus")}</span>
            <select
              value={attachAlignmentStatus}
              onChange={(event) => setAttachAlignmentStatus(event.target.value as StemAlignStatus)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="creator-attach-alignment-status"
            >
              <option value="pending">{t("creatorTracks.alignStatus.pending")}</option>
              <option value="aligned">{t("creatorTracks.alignStatus.aligned")}</option>
              <option value="needs_review">{t("creatorTracks.alignStatus.needsReview")}</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachAlignmentOffsetMs")}</span>
            <input
              value={attachAlignmentOffsetMs}
              onChange={(event) => setAttachAlignmentOffsetMs(event.target.value)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              placeholder="e.g. -42"
              inputMode="numeric"
              data-testid="creator-attach-alignment-offset"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachAlignmentScore")}</span>
            <input
              value={attachAlignmentScore}
              onChange={(event) => setAttachAlignmentScore(event.target.value)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              placeholder="0.00..1.00"
              inputMode="decimal"
              data-testid="creator-attach-alignment-score"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("creatorTracks.subtitleField")}</span>
          <input
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder={t("creatorTracks.subtitlePlaceholder")}
            data-testid="creator-track-subtitle"
          />
        </label>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.visibility")}</span>
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as TrackVisibility)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="creator-track-visibility"
            >
              <option value="private">{t("creatorTracks.visibility.private")}</option>
              <option value="unlisted">{t("creatorTracks.visibility.unlisted")}</option>
              <option value="public">{t("creatorTracks.visibility.public")}</option>
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-xs text-[#d7deea]">
            <input
              type="checkbox"
              checked={publishNow}
              onChange={(event) => setPublishNow(event.target.checked)}
              data-testid="creator-track-publish"
            />
            {t("creatorTracks.publishNow")}
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-[#aab0bb]">{t("creatorTracks.stemsDraft")}</span>
          <textarea
            value={stemsDraft}
            onChange={(event) => setStemsDraft(event.target.value)}
            rows={4}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            placeholder={t("creatorTracks.stemsPlaceholder")}
            data-testid="creator-track-stems"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
          data-testid="creator-track-create"
        >
          {busy ? t("creatorTracks.saving") : t("creatorTracks.create")}
        </button>
      </form>

      <form className="space-y-3 rounded-sm border border-[#3b3f47] bg-[#1b1f26] p-3" onSubmit={onAttachStem}>
        <div className="text-xs uppercase tracking-wide text-[#7f8ba1]">{t("creatorTracks.attachTitle")}</div>
        <div className="text-xs text-[#9aa3b2]">{t("creatorTracks.attachHint")}</div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachTrack")}</span>
            <select
              value={attachTrackId}
              onChange={(event) => setAttachTrackId(event.target.value)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="creator-attach-track"
            >
              <option value="">{t("creatorTracks.attachTrackPlaceholder")}</option>
              {tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.title} (/{track.slug})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachTier")}</span>
            <select
              value={attachTier}
              onChange={(event) => setAttachTier(event.target.value as StemAccessTier)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="creator-attach-tier"
            >
              <option value="free">{t("creatorTracks.stemFree")}</option>
              <option value="premium">{t("creatorTracks.stemPremium")}</option>
            </select>
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachLabel")}</span>
            <input
              value={attachLabel}
              onChange={(event) => setAttachLabel(event.target.value)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
              placeholder={t("creatorTracks.attachLabelPlaceholder")}
              data-testid="creator-attach-label"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-[#aab0bb]">{t("creatorTracks.attachFile")}</span>
            <input
              ref={attachFileRef}
              type="file"
              accept="audio/*"
              onChange={(event) => setAttachFile(event.target.files?.[0] ?? null)}
              className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#d7deea] outline-none"
              data-testid="creator-attach-file"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={attachBusy || !tracks.length}
          className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
          data-testid="creator-attach-submit"
        >
          {attachBusy ? t("creatorTracks.attaching") : t("creatorTracks.attachButton")}
        </button>
      </form>

      {status ? (
        <div className="text-xs text-[#9cc4ff]" data-testid="creator-track-status">
          {status}
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-[#7f8ba1]">{t("creatorTracks.myTracks")}</div>
        {loading ? <div className="text-sm text-[#9aa3b2]">{t("creatorTracks.loading")}</div> : null}
        {!loading && !tracks.length ? (
          <div className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2 text-sm text-[#9aa3b2]">
            {t("creatorTracks.empty")}
          </div>
        ) : null}
        {tracks.map((track) => (
          <article
            key={track.id}
            className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2"
            data-testid={`creator-track-item-${track.slug}`}
          >
            <div className="text-sm font-semibold text-[#e6e8ec]">{track.title}</div>
            <div className="text-xs text-[#9aa3b2]">/{track.slug}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[#8aa6d8]">
              <span>{t("creatorTracks.status")}: {track.status}</span>
              <span>{t("creatorTracks.visibility")}: {track.visibility}</span>
              <span>{t("creatorTracks.stemsCount")}: {track.stems.length}</span>
              <span>{t("creatorTracks.updatedAt")}: {formatTime(track.updatedAt, locale)}</span>
            </div>
            {track.stems.length ? (
              <div className="mt-2 space-y-2 rounded-sm border border-[#2d3139] bg-[#161a21] p-2">
                {track.stems
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((stem) => (
                    <div key={stem.id} className="rounded-sm border border-[#2f3440] bg-[#1b1f26] p-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#d7deea]">
                        <span className="font-medium">{stem.label}</span>
                        <span className="rounded-full border border-[#3d4b63] bg-[#1e2a3d] px-2 py-0.5 text-[10px] uppercase tracking-wide">
                          {stem.accessTier === "premium" ? t("creatorTracks.stemPremium") : t("creatorTracks.stemFree")}
                        </span>
                        <span className="text-[11px] text-[#8aa6d8]">
                          {t("creatorTracks.assetSize")}: {formatBytes(stem.assetSizeBytes)}
                        </span>
                        {stem.assetMimeType ? (
                          <span className="text-[11px] text-[#8aa6d8]">
                            {t("creatorTracks.assetType")}: {stem.assetMimeType}
                          </span>
                        ) : null}
                        <span className="text-[11px] text-[#8aa6d8]">
                          {t("creatorTracks.alignStatus")}: {t(`creatorTracks.alignStatus.${stem.alignmentStatus}`)}
                        </span>
                        <span className="text-[11px] text-[#8aa6d8]">
                          {t("creatorTracks.alignOffset")}: {formatOffsetMs(stem.alignmentOffsetMs)}
                        </span>
                        <span className="text-[11px] text-[#8aa6d8]">
                          {t("creatorTracks.alignScore")}: {formatAlignmentScore(stem.alignmentScore)}
                        </span>
                        <span className="text-[11px] text-[#8aa6d8]">
                          {t("creatorTracks.alignMethod")}: {stem.alignmentMethod ? t(`creatorTracks.alignMethod.${stem.alignmentMethod}`) : "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void onRecomputeStemAlignment(track.id, stem.id, stem.referenceStemId || undefined)
                          }
                          disabled={recomputeStemId === stem.id}
                          className="rounded border border-[#3d4b63] bg-[#202b3f] px-2 py-0.5 text-[11px] text-[#d5e5ff] hover:bg-[#243452] disabled:cursor-not-allowed disabled:opacity-60"
                          data-testid={`creator-stem-recompute-${stem.id}`}
                        >
                          {recomputeStemId === stem.id ? t("creatorTracks.recomputing") : t("creatorTracks.recompute")}
                        </button>
                      </div>
                      {stem.alignmentMeasuredAt ? (
                        <div className="mt-1 text-[11px] text-[#7f8ba1]">
                          {t("creatorTracks.alignMeasuredAt")}: {formatTime(stem.alignmentMeasuredAt, locale)}
                        </div>
                      ) : null}
                      {stem.assetUploadId ? (
                        <audio
                          controls
                          preload="none"
                          className="mt-2 w-full"
                          src={`/api/ugc/assets/${encodeURIComponent(stem.assetUploadId)}/stream`}
                          data-testid={`creator-stem-audio-${stem.id}`}
                        />
                      ) : null}
                    </div>
                  ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
