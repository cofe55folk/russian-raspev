import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import SoundRoutePlayer from "./components/SoundRoutePlayer";
import ArticleRouteAudioPlayer from "./components/ArticleRouteAudioPlayer";
import GlobalFloatingVideoPlayer from "./components/GlobalFloatingVideoPlayer";
import ClientErrorLogger from "./components/ClientErrorLogger";
import I18nProvider from "./components/i18n/I18nProvider";
import { I18N_MESSAGES } from "./lib/i18n/messages";
import { buildLocalePathname } from "./lib/i18n/routing";
import { readRequestLocale } from "./lib/i18n/server";
import { LOCALES, REQUEST_PATHNAME_HEADER_NAME, getLocaleMeta, type Locale } from "./lib/i18n/types";

const FALLBACK_SITE_URL = "http://localhost:3000";

function toOpenGraphLocale(locale: Locale): string {
  return getLocaleMeta(locale).intl.replace("-", "_");
}

function normalizeHeaderPathname(value: string | null): string {
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readRequestLocale();
  const requestHeaders = await headers();
  const normalizedPathname = normalizeHeaderPathname(requestHeaders.get(REQUEST_PATHNAME_HEADER_NAME));
  const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL);
  const alternateLocale = LOCALES.filter((item) => item !== locale).map((item) => toOpenGraphLocale(item));
  const languages = Object.fromEntries(
    LOCALES.map((item) => [getLocaleMeta(item).intl, buildLocalePathname(normalizedPathname, item)])
  );

  return {
    metadataBase,
    title: "Russian Raspev",
    description: I18N_MESSAGES[locale]["layout.description"],
    alternates: {
      canonical: buildLocalePathname(normalizedPathname, locale),
      languages,
    },
    openGraph: {
      locale: toOpenGraphLocale(locale),
      alternateLocale,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialLocale = await readRequestLocale();

  return (
    <html lang={initialLocale}>
      <body className="antialiased">
        <I18nProvider initialLocale={initialLocale}>
          <ClientErrorLogger />
          <div id="rr-sound-player-parking">
            <div id="rr-sound-player-host" />
          </div>
          <SoundRoutePlayer />
          <ArticleRouteAudioPlayer />
          <GlobalFloatingVideoPlayer />
          <Header />
          {children}
          <Footer />
        </I18nProvider>
      </body>
    </html>
  );
}
