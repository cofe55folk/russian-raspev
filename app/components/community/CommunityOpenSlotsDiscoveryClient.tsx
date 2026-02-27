"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

type DiscoveryItem = {
  id: string;
  roomId: string;
  title: string;
  role?: string;
  status: string;
  score: number;
  reasonCodes: DiscoveryReasonCode[];
  room?: {
    id: string;
    title: string;
    referenceContentType?: string;
    referenceContentId?: string;
    status: string;
  } | null;
};

type DiscoveryReasonCode =
  | "OPEN_SLOT"
  | "ROOM_ACTIVE"
  | "SLOT_HAS_ROLE"
  | "SLOT_ROLE_EXACT_MATCH"
  | "ROOM_HAS_REFERENCE"
  | "ROOM_REFERENCE_TYPE_MATCH"
  | "ROOM_REFERENCE_ID_MATCH"
  | "SLOT_RECENT_24H"
  | "SLOT_RECENT_7D"
  | "SLOT_OLDER";

type DiscoveryResponse = {
  items?: DiscoveryItem[];
};

function withHttpStatus(template: string, status: number): string {
  return template.replace("{status}", String(status));
}

function withPlaceholder(template: string, token: string, value: string | number): string {
  return template.replace(`{${token}}`, String(value));
}

export function CommunityOpenSlotsDiscoveryClient() {
  const { t } = useI18n();
  const [role, setRole] = useState("");
  const [referenceContentType, setReferenceContentType] = useState<"" | "sound" | "article" | "video" | "education">("sound");
  const [referenceContentId, setReferenceContentId] = useState("");
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [status, setStatus] = useState(t("community.discovery.statusLoading"));
  const [busy, setBusy] = useState(false);
  const [takingSlotId, setTakingSlotId] = useState<string | null>(null);

  const reasonLabel = useCallback(
    (code: DiscoveryReasonCode): string => {
      switch (code) {
        case "OPEN_SLOT":
          return t("community.discovery.reason.OPEN_SLOT");
        case "ROOM_ACTIVE":
          return t("community.discovery.reason.ROOM_ACTIVE");
        case "SLOT_HAS_ROLE":
          return t("community.discovery.reason.SLOT_HAS_ROLE");
        case "SLOT_ROLE_EXACT_MATCH":
          return t("community.discovery.reason.SLOT_ROLE_EXACT_MATCH");
        case "ROOM_HAS_REFERENCE":
          return t("community.discovery.reason.ROOM_HAS_REFERENCE");
        case "ROOM_REFERENCE_TYPE_MATCH":
          return t("community.discovery.reason.ROOM_REFERENCE_TYPE_MATCH");
        case "ROOM_REFERENCE_ID_MATCH":
          return t("community.discovery.reason.ROOM_REFERENCE_ID_MATCH");
        case "SLOT_RECENT_24H":
          return t("community.discovery.reason.SLOT_RECENT_24H");
        case "SLOT_RECENT_7D":
          return t("community.discovery.reason.SLOT_RECENT_7D");
        case "SLOT_OLDER":
          return t("community.discovery.reason.SLOT_OLDER");
        default:
          return code;
      }
    },
    [t]
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("offset", "0");
      params.set("limit", "100");
      if (role.trim()) params.set("role", role.trim());
      if (referenceContentType) params.set("referenceContentType", referenceContentType);
      if (referenceContentId.trim()) params.set("referenceContentId", referenceContentId.trim());

      const response = await fetch(`/api/community/discovery/open-slots?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        setStatus(withHttpStatus(t("community.discovery.statusLoadFailedHttp"), response.status));
        setItems([]);
        return;
      }
      const payload = (await response.json()) as DiscoveryResponse;
      setItems(payload.items || []);
      setStatus(t("community.discovery.statusOk"));
    } finally {
      setBusy(false);
    }
  }, [referenceContentId, referenceContentType, role, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const takeSlot = useCallback(
    async (slotId: string) => {
      setTakingSlotId(slotId);
      try {
        const sourceTakeId = `discovery-cta-${Date.now()}-${slotId.slice(0, 8)}`;
        const response = await fetch(`/api/community/slots/${encodeURIComponent(slotId)}/take`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceTakeId,
            note: "Discovery slot fill CTA",
          }),
        });
        if (response.status === 401) {
          setStatus(t("community.discovery.statusTakeAuthRequired"));
          return;
        }
        if (!response.ok) {
          setStatus(withHttpStatus(t("community.discovery.statusTakeFailedHttp"), response.status));
          return;
        }
        await load();
        setStatus(t("community.discovery.statusTakeSuccess"));
      } finally {
        setTakingSlotId(null);
      }
    },
    [load, t]
  );

  return (
    <section className="space-y-4" data-testid="community-discovery-open-slots-root">
      <div className="rr-article-panel space-y-3 p-4">
        <h1 className="text-lg font-semibold text-[#e6e8ec]">{t("community.discovery.title")}</h1>
        <p className="text-sm text-[#9aa3b2]">{t("community.discovery.description")}</p>

        <div className="grid gap-3 md:grid-cols-3">
          <input
            className="rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
            placeholder={t("community.discovery.rolePlaceholder")}
            value={role}
            onChange={(event) => setRole(event.target.value)}
            data-testid="community-discovery-role-input"
          />
          <select
            className="rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
            value={referenceContentType}
            onChange={(event) =>
              setReferenceContentType(event.target.value as "" | "sound" | "article" | "video" | "education")
            }
            data-testid="community-discovery-type-select"
          >
            <option value="">{t("community.discovery.typeAny")}</option>
            <option value="sound">{t("community.discovery.type.sound")}</option>
            <option value="article">{t("community.discovery.type.article")}</option>
            <option value="video">{t("community.discovery.type.video")}</option>
            <option value="education">{t("community.discovery.type.education")}</option>
          </select>
          <input
            className="rounded-md border border-[#2d3f56] bg-[#111826] px-3 py-2 text-sm text-[#e6e8ec]"
            placeholder={t("community.discovery.referencePlaceholder")}
            value={referenceContentId}
            onChange={(event) => setReferenceContentId(event.target.value)}
            data-testid="community-discovery-reference-input"
          />
        </div>

        <button
          type="button"
          className="rounded-md border border-[#4a6fa1] px-3 py-1.5 text-sm text-[#d9ebff] disabled:opacity-60"
          disabled={busy}
          onClick={() => void load()}
          data-testid="community-discovery-apply"
        >
          {t("community.discovery.applyFilter")}
        </button>
      </div>

      <div className="text-xs text-[#9cc4ff]" data-testid="community-discovery-status">
        {status}
      </div>

      <div className="space-y-2" data-testid="community-discovery-open-slots-list">
        {items.length === 0 ? (
          <div className="rr-article-panel p-3 text-sm text-[#9aa3b2]" data-testid="community-discovery-empty">
            {t("community.discovery.empty")}
          </div>
        ) : null}
        {items.map((item) => (
          <article
            key={item.id}
            className="rr-article-panel p-3"
            data-testid={`community-discovery-slot-item-${item.id}`}
            data-score={String(item.score)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[#e6e8ec]" data-testid={`community-discovery-slot-room-${item.id}`}>
                {item.room?.title || item.roomId}
              </span>
              <span className="rounded border border-[#3f587b] px-2 py-0.5 text-xs text-[#d2e7ff]">
                {withPlaceholder(t("community.discovery.scoreLabel"), "score", item.score)}
              </span>
              {item.role ? (
                <span className="text-xs text-[#8ea7c5]">{withPlaceholder(t("community.discovery.roleLabel"), "role", item.role)}</span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-[#9aa3b2]">{item.title}</div>
            <div className="mt-2 text-xs text-[#8ea7c5]" data-testid={`community-discovery-slot-reasons-${item.id}`}>
              <div className="mb-1 text-[#95b4d8]">{t("community.discovery.reasonsTitle")}</div>
              <ul className="space-y-1">
                {item.reasonCodes.map((code) => (
                  <li key={code} data-testid={`community-discovery-slot-reason-${item.id}-${code}`}>
                    {reasonLabel(code)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-2">
              <button
                type="button"
                className="rounded-md border border-[#4a6fa1] px-2.5 py-1 text-xs text-[#d9ebff] disabled:opacity-60"
                disabled={busy || takingSlotId === item.id}
                onClick={() => void takeSlot(item.id)}
                data-testid={`community-discovery-slot-take-${item.id}`}
              >
                {takingSlotId === item.id ? t("community.discovery.takeSlotBusy") : t("community.discovery.takeSlotCta")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
