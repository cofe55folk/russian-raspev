"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import PageHero from "../components/PageHero";
import { useI18n } from "../components/i18n/I18nProvider";
import { getAccountHref } from "../lib/i18n/routing";
import type { AuthProviderId, AuthProviderStatus } from "../lib/auth/providers";

type AuthMode = "register" | "login";

type ApiErrorShape = {
  error?: string;
};

type ProvidersResponseShape = {
  providers?: AuthProviderStatus[];
};

type PhoneStartResponseShape = {
  ok?: boolean;
  debugCode?: string;
};

type DevProfilePreset = {
  id: string;
  label: string;
  accent?: boolean;
  payload: {
    email: string;
    name: string;
    entitlements?: string[];
    premiumTrackSlugs?: string[];
  };
};

function readApiError(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "Request failed";
  const payload = raw as ApiErrorShape;
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  return "Request failed";
}

function readProviders(raw: unknown): AuthProviderStatus[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as ProvidersResponseShape;
  if (!Array.isArray(payload.providers)) return [];
  return payload.providers.filter((item): item is AuthProviderStatus => {
    if (!item || typeof item !== "object") return false;
    const row = item as AuthProviderStatus;
    return typeof row.id === "string" && Array.isArray(row.missingEnv);
  });
}

export default function AuthPage() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [providers, setProviders] = useState<AuthProviderStatus[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersLoadError, setProvidersLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadProviders = async () => {
      setProvidersLoading(true);
      setProvidersLoadError("");
      try {
        const response = await fetch("/api/auth/providers", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = readProviders((await response.json()) as unknown);
        if (!cancelled) {
          setProviders(payload);
        }
      } catch {
        if (!cancelled) {
          setProviders([]);
          setProvidersLoadError(t("auth.providers.loadFailed"));
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false);
        }
      }
    };
    loadProviders();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const oauthError = searchParams.get("oauth_error");
    if (oauthError) {
      setStatus(`${t("auth.oauthErrorPrefix")}: ${oauthError}`);
    }
  }, [searchParams, t]);

  const submit = async (endpoint: string, payload?: unknown) => {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: payload ? { "content-type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const errorPayload = (await response.json()) as unknown;
          message = readApiError(errorPayload);
        } catch {}
        throw new Error(message);
      }
      router.push(getAccountHref(locale));
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const onSubmitMain = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "register") {
      await submit("/api/auth/register", {
        name,
        email,
        password,
      });
      return;
    }
    await submit("/api/auth/login", {
      email,
      password,
    });
  };

  const isDevMode = process.env.NODE_ENV !== "production";
  const devProfiles: DevProfilePreset[] = [
    {
      id: "owner",
      label: t("auth.loginOwner"),
      accent: true,
      payload: {
        email: "owner@ruspev.local",
        name: "Owner Admin",
        entitlements: [
          "course:vocal:full",
          "marathon:khorovod:access",
          "improv:pack:access",
          "course:porushka-foundation:access",
        ],
        premiumTrackSlugs: ["novosibirsk-severnoe-na-ulitse-veetsya", "bolshoy-kunaley-chto-ty-vanya"],
      },
    },
    {
      id: "student-basic",
      label: t("auth.loginStudentBasic"),
      payload: {
        email: "student-basic@ruspev.local",
        name: "Student Basic",
      },
    },
    {
      id: "student-paid",
      label: t("auth.loginStudentPaid"),
      payload: {
        email: "student-paid@ruspev.local",
        name: "Student Paid",
        entitlements: ["course:vocal:full"],
      },
    },
  ];

  const resolveProviderLabel = (providerId: AuthProviderId): string => {
    switch (providerId) {
      case "google":
        return t("auth.provider.google");
      case "apple":
        return t("auth.provider.apple");
      case "yandex":
        return t("auth.provider.yandex");
      case "vk":
        return t("auth.provider.vk");
      case "phone":
        return t("auth.provider.phone");
      default:
        return providerId;
    }
  };

  const onProviderClick = (provider: AuthProviderStatus) => {
    if (!provider.enabled || busy) return;
    if (provider.id === "yandex") {
      window.location.assign("/api/auth/oauth/yandex/start");
      return;
    }
    if (provider.id === "vk") {
      window.location.assign("/api/auth/oauth/vk/start");
      return;
    }
    if (provider.id === "phone") {
      const run = async () => {
        const phone = window.prompt(t("auth.phone.promptPhone"));
        if (!phone) return;

        setBusy(true);
        setStatus("");
        try {
          const startResponse = await fetch("/api/auth/phone/start", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ phone }),
          });
          const startPayload = (await startResponse.json()) as PhoneStartResponseShape & ApiErrorShape;
          if (!startResponse.ok) {
            throw new Error(readApiError(startPayload));
          }

          const codePrompt = startPayload.debugCode
            ? `${t("auth.phone.promptCode")} (${t("auth.phone.debugCodeLabel")}: ${startPayload.debugCode})`
            : t("auth.phone.promptCode");
          const code = window.prompt(codePrompt);
          if (!code) {
            setStatus(t("auth.phone.promptCanceled"));
            return;
          }

          const verifyResponse = await fetch("/api/auth/phone/verify", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ phone, code }),
          });
          const verifyPayload = (await verifyResponse.json()) as ApiErrorShape;
          if (!verifyResponse.ok) {
            throw new Error(readApiError(verifyPayload));
          }
          router.push(getAccountHref(locale));
          router.refresh();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Request failed");
        } finally {
          setBusy(false);
        }
      };
      void run();
      return;
    }
    setStatus(t("auth.providers.notImplementedYet"));
  };

  return (
    <main className="rr-main">
      <PageHero title={t("auth.pageTitle")} subtitle={t("auth.pageSubtitle")} />
      <section className="rr-container mt-8 max-w-2xl">
        <div className="rr-article-panel space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("register")}
              data-testid="auth-mode-register"
              className={`rr-article-btn px-3 py-2 text-sm ${
                mode === "register" ? "border-[#5f82aa] text-[#dce8ff]" : ""
              }`}
            >
              {t("auth.mode.register")}
            </button>
            <button
              type="button"
              onClick={() => setMode("login")}
              data-testid="auth-mode-login"
              className={`rr-article-btn px-3 py-2 text-sm ${
                mode === "login" ? "border-[#5f82aa] text-[#dce8ff]" : ""
              }`}
            >
              {t("auth.mode.login")}
            </button>
          </div>

          <form className="space-y-3" onSubmit={onSubmitMain}>
            {mode === "register" ? (
              <label className="block space-y-1">
                <span className="text-xs text-[#9aa3b2]">{t("auth.field.name")}</span>
                <input
                  data-testid="auth-name-input"
                  className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>
            ) : null}

            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("auth.field.email")}</span>
              <input
                data-testid="auth-email-input"
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputMode="email"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-[#9aa3b2]">{t("auth.field.password")}</span>
              <input
                data-testid="auth-password-input"
                className="w-full rounded-sm border border-[#3b3f47] bg-[#20232b] px-3 py-2 text-sm text-[#e6e8ec] outline-none"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy}
                data-testid="auth-submit"
                className="rr-article-btn-accent px-3 py-2 text-sm disabled:opacity-50"
              >
                {mode === "register" ? t("auth.registerSubmit") : t("auth.loginSubmit")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => submit("/api/auth/logout")}
                data-testid="auth-logout"
                className="rr-article-btn px-3 py-2 text-sm disabled:opacity-50"
              >
                {t("auth.logout")}
              </button>
            </div>
          </form>

          {busy ? <div className="text-xs text-[#9cc4ff]">{t("auth.requestPending")}</div> : null}
          {status ? (
            <div className="text-xs text-[#f5b4b4]" data-testid="auth-status">
              {status}
            </div>
          ) : null}

          <div className="space-y-2 rounded-sm border border-[#3b3f47] bg-[#20232b] p-3" data-testid="auth-providers">
            <div className="text-xs uppercase tracking-[0.06em] text-[#9aa3b2]">{t("auth.providers.title")}</div>
            <p className="text-xs text-[#9aa3b2]">{t("auth.providers.subtitle")}</p>
            {providersLoading ? (
              <div className="text-xs text-[#9cc4ff]" data-testid="auth-providers-loading">
                {t("auth.providers.loading")}
              </div>
            ) : null}
            {providersLoadError ? <div className="text-xs text-[#f5b4b4]">{providersLoadError}</div> : null}
            {!providersLoading && !providersLoadError && providers.length === 0 ? (
              <div className="text-xs text-[#9aa3b2]">{t("auth.providers.empty")}</div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="rounded-sm border border-[#3b3f47] bg-[#161a20] p-3"
                  data-testid={`auth-provider-card-${provider.id}`}
                >
                  <button
                    type="button"
                    disabled={busy || !provider.enabled}
                    onClick={() => onProviderClick(provider)}
                    data-testid={`auth-provider-${provider.id}`}
                    className="rr-article-btn w-full px-3 py-2 text-sm disabled:opacity-50"
                  >
                    {t("auth.providers.continueWith")} {resolveProviderLabel(provider.id)}
                  </button>
                  <div className="mt-2 text-[11px] text-[#9aa3b2]">
                    {provider.enabled ? t("auth.providers.enabled") : t("auth.providers.disabled")}
                  </div>
                  {provider.enabled && provider.id !== "yandex" && provider.id !== "vk" && provider.id !== "phone" ? (
                    <div className="mt-1 text-[11px] text-[#9aa3b2]">{t("auth.providers.flowPending")}</div>
                  ) : null}
                  {!provider.enabled && provider.missingEnv.length > 0 ? (
                    <div className="mt-1 text-[11px] text-[#9aa3b2]" data-testid={`auth-provider-missing-${provider.id}`}>
                      {t("auth.providers.missingEnv")}: {provider.missingEnv.join(", ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {isDevMode ? (
            <div className="space-y-3 rounded-sm border border-[#3b3f47] bg-[#20232b] p-3">
              <div className="text-xs text-[#9aa3b2]">{t("auth.devNote")}</div>
              <div className="text-xs uppercase tracking-[0.06em] text-[#9aa3b2]">{t("auth.devQuickTitle")}</div>
              <div className="flex flex-wrap gap-2">
                {devProfiles.map((preset) => (
                  <button
                    key={preset.id}
                    disabled={busy}
                    onClick={() => submit("/api/auth/dev-login", preset.payload)}
                    data-testid={`auth-dev-login-${preset.id}`}
                    className={`px-3 py-2 text-sm disabled:opacity-50 ${
                      preset.accent ? "rr-article-btn-accent" : "rr-article-btn"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <Link href={getAccountHref(locale)} className="rr-article-link text-sm">
            {t("auth.openAccount")}
          </Link>
        </div>
      </section>
    </main>
  );
}
