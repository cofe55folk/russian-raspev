"use client";

import { useEffect, useState } from "react";
import { readAdminSecretClient, writeAdminSecretClient } from "../../lib/admin/clientSecret";
import { useI18n } from "../i18n/I18nProvider";

type EventStatus = "draft" | "published" | "archived" | "canceled";

type AdminEvent = {
  slug: string;
  status: EventStatus;
  dateIso: string;
  coverSrc: string;
  ticketUrl: string;
  tags: string[];
  venue: {
    id: string;
    city: string;
    coordinates: [number, number];
  };
  occurrences: Array<{
    id: string;
    startIso: string;
    endIso: string | null;
    timezone: string;
    recurring: boolean;
  }>;
  translations: {
    ru: {
      title: string;
      description: string;
      venue: string;
      city: string;
      ticketLabel: string;
    };
    en: {
      title: string;
      description: string;
      venue: string;
      city: string;
      ticketLabel: string;
    };
  };
};

const EMPTY_FORM = {
  slug: "",
  status: "draft" as EventStatus,
  coverSrc: "/hero.jpg",
  ticketUrl: "https://t.me/russian_raspev",
  tagsCsv: "workshop",
  venueId: "",
  latitude: "55.7558",
  longitude: "37.6176",
  occurrenceId: "",
  startIso: "",
  endIso: "",
  timezone: "Europe/Moscow",
  recurring: false,
  titleRu: "",
  descriptionRu: "",
  venueRu: "",
  cityRu: "",
  ticketLabelRu: "Записаться",
  titleEn: "",
  descriptionEn: "",
  venueEn: "",
  cityEn: "",
  ticketLabelEn: "Register",
};

export default function AdminEventsClient() {
  const { t, locale } = useI18n();
  const [secret, setSecret] = useState("");
  const [secretReady, setSecretReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    setSecret(readAdminSecretClient());
    setSecretReady(true);
  }, []);

  useEffect(() => {
    if (!secretReady) return;
    writeAdminSecretClient(secret);
  }, [secret, secretReady]);

  const loadEvents = async () => {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/admin/events?locale=${locale}`, {
        headers: { "x-rr-admin-secret": secret.trim() },
        cache: "no-store",
      });
      const payload = (await response.json()) as { events?: AdminEvent[]; error?: string };
      if (!response.ok) {
        setStatus(`${t("admin.events.error")}: ${payload.error || `HTTP ${response.status}`}`);
        return;
      }
      setEvents(payload.events || []);
      setStatus(t("admin.events.loaded"));
    } catch (error) {
      setStatus(`${t("admin.events.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const hydrateFormFromEvent = (event: AdminEvent) => {
    const primary = [...event.occurrences].sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime())[0];
    setForm({
      slug: event.slug,
      status: event.status,
      coverSrc: event.coverSrc,
      ticketUrl: event.ticketUrl,
      tagsCsv: event.tags.join(", "),
      venueId: event.venue.id,
      latitude: String(event.venue.coordinates[0]),
      longitude: String(event.venue.coordinates[1]),
      occurrenceId: primary?.id || `${event.slug}-occ-1`,
      startIso: primary?.startIso.slice(0, 16) || event.dateIso.slice(0, 16),
      endIso: primary?.endIso ? primary.endIso.slice(0, 16) : "",
      timezone: primary?.timezone || "Europe/Moscow",
      recurring: Boolean(primary?.recurring),
      titleRu: event.translations.ru.title,
      descriptionRu: event.translations.ru.description,
      venueRu: event.translations.ru.venue,
      cityRu: event.translations.ru.city,
      ticketLabelRu: event.translations.ru.ticketLabel,
      titleEn: event.translations.en.title,
      descriptionEn: event.translations.en.description,
      venueEn: event.translations.en.venue,
      cityEn: event.translations.en.city,
      ticketLabelEn: event.translations.en.ticketLabel,
    });
    setSelectedSlug(event.slug);
  };

  const resetForm = () => {
    setSelectedSlug("");
    setForm(EMPTY_FORM);
  };

  const upsertEvent = async () => {
    setBusy(true);
    setStatus("");
    try {
      const startIso = form.startIso ? new Date(form.startIso).toISOString() : "";
      const endIso = form.endIso ? new Date(form.endIso).toISOString() : null;
      const lat = Number(form.latitude);
      const lon = Number(form.longitude);
      const slug = form.slug.trim().toLowerCase();
      const payload = {
        event: {
          slug,
          status: form.status,
          coverSrc: form.coverSrc.trim(),
          ticketUrl: form.ticketUrl.trim(),
          tags: form.tagsCsv
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          venue: {
            id: form.venueId.trim() || `${slug}-venue`,
            city: form.cityRu.trim(),
            coordinates: [lat, lon],
          },
          occurrences: [
            {
              id: form.occurrenceId.trim() || `${slug}-occ-1`,
              startIso,
              endIso,
              timezone: form.timezone.trim() || "Europe/Moscow",
              recurring: form.recurring,
            },
          ],
          translations: {
            ru: {
              title: form.titleRu.trim(),
              description: form.descriptionRu.trim(),
              venue: form.venueRu.trim(),
              city: form.cityRu.trim(),
              ticketLabel: form.ticketLabelRu.trim(),
            },
            en: {
              title: form.titleEn.trim(),
              description: form.descriptionEn.trim(),
              venue: form.venueEn.trim(),
              city: form.cityEn.trim(),
              ticketLabel: form.ticketLabelEn.trim(),
            },
          },
        },
        source: "admin-events-ui",
        actor: "admin-ui",
      };

      const response = await fetch("/api/admin/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rr-admin-secret": secret.trim(),
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string; created?: boolean };
      if (!response.ok) {
        setStatus(`${t("admin.events.error")}: ${result.error || `HTTP ${response.status}`}`);
        return;
      }
      setStatus(result.created ? t("admin.events.created") : t("admin.events.updated"));
      await loadEvents();
    } catch (error) {
      setStatus(`${t("admin.events.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (slug: string, nextStatus: EventStatus) => {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/admin/events", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-rr-admin-secret": secret.trim(),
        },
        body: JSON.stringify({
          slug,
          status: nextStatus,
          actor: "admin-ui",
          source: "admin-events-ui",
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(`${t("admin.events.error")}: ${payload.error || `HTTP ${response.status}`}`);
        return;
      }
      setStatus(t("admin.events.statusSaved"));
      await loadEvents();
    } catch (error) {
      setStatus(`${t("admin.events.error")}: ${error instanceof Error ? error.message : "Request failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" data-testid="admin-events-root">
      <div className="rr-article-panel space-y-3 p-4">
        <div className="text-sm text-[#9aa3b2]">{t("admin.events.hint")}</div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={t("admin.entitlements.secret")}
            className="w-full max-w-sm rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-secret"
          />
          <button
            type="button"
            onClick={() => {
              void loadEvents();
            }}
            className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy || !secret.trim()}
            data-testid="admin-events-load"
          >
            {busy ? t("feedback.sending") : t("admin.events.load")}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-sm border border-[#3b3f47] px-3 py-2 text-sm text-[#d5dbea]"
            data-testid="admin-events-new"
          >
            {t("admin.events.new")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rr-article-panel p-4">
          <div className="mb-3 text-sm font-semibold text-[#e6e8ec]">{t("admin.events.listTitle")}</div>
          <div className="space-y-2" data-testid="admin-events-list">
            {events.map((event) => (
              <article
                key={event.slug}
                className={`rounded-sm border p-3 ${selectedSlug === event.slug ? "border-[#5f82aa]" : "border-[#3b3f47]"}`}
                data-testid={`admin-events-item-${event.slug}`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => hydrateFormFromEvent(event)}
                  data-testid={`admin-events-select-${event.slug}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[#e6e8ec]">{event.slug}</div>
                    <div className="rounded-sm bg-[#1e2a3b] px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-[#9cc4ff]">
                      {event.status}
                    </div>
                  </div>
                  <div className="text-xs text-[#9aa3b2]">{event.dateIso}</div>
                </button>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="rounded-sm border border-[#3b3f47] px-2 py-1 text-[11px] text-[#d5dbea]"
                    onClick={() => {
                      void changeStatus(event.slug, "published");
                    }}
                    data-testid={`admin-events-publish-${event.slug}`}
                  >
                    {t("admin.events.action.publish")}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-[#3b3f47] px-2 py-1 text-[11px] text-[#d5dbea]"
                    onClick={() => {
                      void changeStatus(event.slug, "draft");
                    }}
                    data-testid={`admin-events-unpublish-${event.slug}`}
                  >
                    {t("admin.events.action.unpublish")}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-[#3b3f47] px-2 py-1 text-[11px] text-[#d5dbea]"
                    onClick={() => {
                      void changeStatus(event.slug, "archived");
                    }}
                    data-testid={`admin-events-archive-${event.slug}`}
                  >
                    {t("admin.events.action.archive")}
                  </button>
                </div>
              </article>
            ))}
            {!events.length ? <div className="text-sm text-[#9aa3b2]">{t("admin.events.empty")}</div> : null}
          </div>
        </div>

        <form
          className="rr-article-panel space-y-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void upsertEvent();
          }}
          data-testid="admin-events-form"
        >
          <div className="text-sm font-semibold text-[#e6e8ec]">{t("admin.events.formTitle")}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={form.slug}
              onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
              placeholder={t("admin.events.slug")}
              className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="admin-events-form-slug"
            />
            <select
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as EventStatus }))}
              className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="admin-events-form-status"
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={form.startIso}
              onChange={(event) => setForm((prev) => ({ ...prev, startIso: event.target.value }))}
              type="datetime-local"
              className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="admin-events-form-start"
            />
            <input
              value={form.endIso}
              onChange={(event) => setForm((prev) => ({ ...prev, endIso: event.target.value }))}
              type="datetime-local"
              className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="admin-events-form-end"
            />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={form.latitude}
              onChange={(event) => setForm((prev) => ({ ...prev, latitude: event.target.value }))}
              placeholder="latitude"
              className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="admin-events-form-lat"
            />
            <input
              value={form.longitude}
              onChange={(event) => setForm((prev) => ({ ...prev, longitude: event.target.value }))}
              placeholder="longitude"
              className="rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
              data-testid="admin-events-form-lon"
            />
          </div>
          <input
            value={form.tagsCsv}
            onChange={(event) => setForm((prev) => ({ ...prev, tagsCsv: event.target.value }))}
            placeholder={t("admin.events.tags")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-tags"
          />
          <input
            value={form.ticketUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, ticketUrl: event.target.value }))}
            placeholder="https://..."
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-ticket-url"
          />
          <input
            value={form.titleRu}
            onChange={(event) => setForm((prev) => ({ ...prev, titleRu: event.target.value }))}
            placeholder={t("admin.events.titleRu")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-title-ru"
          />
          <textarea
            value={form.descriptionRu}
            onChange={(event) => setForm((prev) => ({ ...prev, descriptionRu: event.target.value }))}
            placeholder={t("admin.events.descriptionRu")}
            className="h-20 w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-description-ru"
          />
          <input
            value={form.cityRu}
            onChange={(event) => setForm((prev) => ({ ...prev, cityRu: event.target.value }))}
            placeholder={t("admin.events.cityRu")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-city-ru"
          />
          <input
            value={form.venueRu}
            onChange={(event) => setForm((prev) => ({ ...prev, venueRu: event.target.value }))}
            placeholder={t("admin.events.venueRu")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-venue-ru"
          />
          <input
            value={form.ticketLabelRu}
            onChange={(event) => setForm((prev) => ({ ...prev, ticketLabelRu: event.target.value }))}
            placeholder={t("admin.events.ticketLabelRu")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-ticket-label-ru"
          />
          <input
            value={form.titleEn}
            onChange={(event) => setForm((prev) => ({ ...prev, titleEn: event.target.value }))}
            placeholder={t("admin.events.titleEn")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-title-en"
          />
          <textarea
            value={form.descriptionEn}
            onChange={(event) => setForm((prev) => ({ ...prev, descriptionEn: event.target.value }))}
            placeholder={t("admin.events.descriptionEn")}
            className="h-20 w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-description-en"
          />
          <input
            value={form.cityEn}
            onChange={(event) => setForm((prev) => ({ ...prev, cityEn: event.target.value }))}
            placeholder={t("admin.events.cityEn")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-city-en"
          />
          <input
            value={form.venueEn}
            onChange={(event) => setForm((prev) => ({ ...prev, venueEn: event.target.value }))}
            placeholder={t("admin.events.venueEn")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-venue-en"
          />
          <input
            value={form.ticketLabelEn}
            onChange={(event) => setForm((prev) => ({ ...prev, ticketLabelEn: event.target.value }))}
            placeholder={t("admin.events.ticketLabelEn")}
            className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-2.5 py-2 text-sm text-[#e6e8ec] outline-none"
            data-testid="admin-events-form-ticket-label-en"
          />

          <button
            type="submit"
            disabled={busy || !secret.trim()}
            className="rr-article-btn-accent px-4 py-2 text-sm disabled:opacity-50"
            data-testid="admin-events-save"
          >
            {busy ? t("feedback.sending") : t("admin.events.save")}
          </button>
          {status ? (
            <div className="text-xs text-[#9cc4ff]" data-testid="admin-events-status">
              {status}
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
