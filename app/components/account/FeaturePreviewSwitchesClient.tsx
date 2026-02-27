"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "../i18n/I18nProvider";

type Props = {
  initialFlags: string[];
};

type PreviewFeatureItem = {
  key: "ugc_creator_tracks" | "multitrack_progressive_load" | "recording_engine_v2";
  titleKey:
    | "preview.feature.ugcCreatorTracks.title"
    | "preview.feature.multitrackProgressiveLoad.title"
    | "preview.feature.recordingEngineV2.title";
  descriptionKey:
    | "preview.feature.ugcCreatorTracks.description"
    | "preview.feature.multitrackProgressiveLoad.description"
    | "preview.feature.recordingEngineV2.description";
};

const PREVIEW_FEATURES: PreviewFeatureItem[] = [
  {
    key: "ugc_creator_tracks",
    titleKey: "preview.feature.ugcCreatorTracks.title",
    descriptionKey: "preview.feature.ugcCreatorTracks.description",
  },
  {
    key: "multitrack_progressive_load",
    titleKey: "preview.feature.multitrackProgressiveLoad.title",
    descriptionKey: "preview.feature.multitrackProgressiveLoad.description",
  },
  {
    key: "recording_engine_v2",
    titleKey: "preview.feature.recordingEngineV2.title",
    descriptionKey: "preview.feature.recordingEngineV2.description",
  },
];

export default function FeaturePreviewSwitchesClient({ initialFlags }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [flags, setFlags] = useState<Set<string>>(new Set(initialFlags));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const toggle = async (key: string, enabled: boolean) => {
    setBusyKey(key);
    setStatus("");
    try {
      const response = await fetch("/api/feature-flags/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ key, enabled }),
      });
      const payload = (await response.json()) as { flags?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const nextFlags = new Set(payload.flags || []);
      setFlags(nextFlags);
      setStatus(t("preview.saved"));
      router.refresh();
    } catch (error) {
      setStatus(`${t("preview.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="space-y-3 rounded-sm border border-[#3b3f47] bg-[#20232b] p-4" data-testid="preview-switches">
      <div className="text-sm font-semibold text-[#e6e8ec]">{t("preview.title")}</div>
      <div className="text-xs text-[#9aa3b2]">{t("preview.hint")}</div>

      <div className="space-y-2">
        {PREVIEW_FEATURES.map((feature) => {
          const enabled = flags.has(feature.key);
          const busy = busyKey === feature.key;
          return (
            <article
              key={feature.key}
              className="rounded-sm border border-[#3b3f47] bg-[#1b1f26] px-3 py-2"
              data-testid={`preview-feature-${feature.key}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[#e6e8ec]">{t(feature.titleKey)}</div>
                  <div className="text-xs text-[#9aa3b2]">{t(feature.descriptionKey)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(feature.key, !enabled)}
                  disabled={busy}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    enabled
                      ? "border-[#2d6b43] bg-[#163827] text-[#9fe0b5]"
                      : "border-[#6b4d2d] bg-[#3a2b1b] text-[#ffdca8]"
                  } disabled:opacity-50`}
                  data-testid={`preview-toggle-${feature.key}`}
                >
                  {busy ? t("preview.saving") : enabled ? t("preview.enabled") : t("preview.disabled")}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {status ? (
        <div className="text-xs text-[#9cc4ff]" data-testid="preview-status">
          {status}
        </div>
      ) : null}
    </section>
  );
}
