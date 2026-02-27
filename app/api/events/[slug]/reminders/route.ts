import { NextResponse, type NextRequest } from "next/server";
import { getPublishedEventBySlug } from "../../../../lib/eventsCatalog";
import { upsertReminderConsent, revokeReminderConsent, type ReminderChannel } from "../../../../lib/eventsReminderStore";
import { getEventHref } from "../../../../lib/i18n/routing";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../../../../lib/i18n/types";
import { allowRateLimit } from "../../../../lib/security/rateLimit";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

type ReminderPayload = {
  action?: string;
  channel?: string;
  contact?: string;
  locale?: string;
};

function normalizeChannel(raw: string | undefined): ReminderChannel | null {
  if (raw === "telegram") return "telegram";
  if (raw === "email") return "email";
  return null;
}

function normalizeLocale(raw: string | undefined): Locale {
  if (isLocale(raw)) return raw;
  return DEFAULT_LOCALE;
}

function normalizeContact(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim().slice(0, 180);
}

function validateContact(channel: ReminderChannel, contact: string): boolean {
  if (!contact) return false;
  if (channel === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  }
  return /^@?[A-Za-z0-9_]{5,64}$/.test(contact);
}

async function parsePayload(request: NextRequest): Promise<ReminderPayload> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as ReminderPayload;
  }
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      action: String(form.get("action") || ""),
      channel: String(form.get("channel") || ""),
      contact: String(form.get("contact") || ""),
      locale: String(form.get("locale") || ""),
    };
  }
  return {};
}

function redirectUrl(params: { locale: Locale; slug: string; status: "subscribed" | "revoked" | "failed" }) {
  const href = getEventHref(params.locale, params.slug);
  const search = new URLSearchParams({ reminder: params.status });
  return `${href}?${search.toString()}`;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowRateLimit(`events-reminders:post:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { slug } = await context.params;
  if (!getPublishedEventBySlug(slug)) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  let payload: ReminderPayload = {};
  try {
    payload = await parsePayload(request);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const locale = normalizeLocale(payload.locale);
  const channel = normalizeChannel(payload.channel);
  const contact = normalizeContact(payload.contact);
  const action = (payload.action || "subscribe").trim().toLowerCase();
  const wantsRedirect = request.nextUrl.searchParams.get("redirect") === "1";

  if (!channel || !validateContact(channel, contact)) {
    if (wantsRedirect) {
      return NextResponse.redirect(new URL(redirectUrl({ locale, slug, status: "failed" }), request.url), 303);
    }
    return NextResponse.json({ error: "Invalid channel or contact" }, { status: 400 });
  }

  if (action === "revoke") {
    const result = await revokeReminderConsent({ eventSlug: slug, channel, contact });
    if (wantsRedirect) {
      return NextResponse.redirect(new URL(redirectUrl({ locale, slug, status: "revoked" }), request.url), 303);
    }
    return NextResponse.json(
      {
        ok: true,
        revoked: result.revoked,
        reminderId: result.record?.id ?? null,
      },
      { status: 200 }
    );
  }

  const result = await upsertReminderConsent({
    eventSlug: slug,
    channel,
    contact,
    locale,
  });
  if (wantsRedirect) {
    return NextResponse.redirect(new URL(redirectUrl({ locale, slug, status: "subscribed" }), request.url), 303);
  }
  return NextResponse.json(
    {
      ok: true,
      reminderId: result.record.id,
      created: result.created,
    },
    { status: result.created ? 201 : 200 }
  );
}
