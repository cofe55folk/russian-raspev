import PageHero from "../components/PageHero";
import YandexArchiveMap from "../components/YandexArchiveMap";
import { getLocalizedPublishedEvents } from "../lib/eventsCatalog";
import { I18N_MESSAGES } from "../lib/i18n/messages";
import { readRequestLocale } from "../lib/i18n/server";

type PageProps = {
  searchParams: Promise<{ layer?: string; view?: string; filters?: string; dataset?: string }>;
};

function normalizeLayer(raw: string | undefined): "genre" | "region" | "expedition" {
  if (raw === "genre" || raw === "region" || raw === "expedition") return raw;
  return "genre";
}

function normalizeView(raw: string | undefined): "points" | "clusters" {
  if (raw === "points" || raw === "clusters") return raw;
  return "points";
}

function normalizeFilters(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDataset(raw: string | undefined): "archive" | "events" | "mixed" {
  if (raw === "archive" || raw === "events" || raw === "mixed") return raw;
  return "mixed";
}

export default async function MapPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const locale = await readRequestLocale();
  const t = (key: string) => I18N_MESSAGES[locale][key as keyof (typeof I18N_MESSAGES)["ru"]] ?? key;
  const initialLayerMode = normalizeLayer(params.layer);
  const initialViewMode = normalizeView(params.view);
  const initialSelectedValues = normalizeFilters(params.filters);
  const initialDataset = normalizeDataset(params.dataset);
  const initialEventItems = getLocalizedPublishedEvents(locale).map((event) => ({
    slug: event.slug,
    title: event.content.title,
    dateLabel: event.dateLabel,
    city: event.content.city,
    tags: event.tags,
    dateIso: event.dateIso,
    coordinates: event.coordinates,
  }));

  return (
    <main className="rr-main">
      <PageHero title={t("nav.map")} />

      <section className="rr-container mt-10">
        <YandexArchiveMap
          locale={locale}
          initialDataset={initialDataset}
          initialLayerMode={initialLayerMode}
          initialViewMode={initialViewMode}
          initialSelectedValues={initialSelectedValues}
          initialEventItems={initialEventItems}
        />
      </section>
    </main>
  );
}
