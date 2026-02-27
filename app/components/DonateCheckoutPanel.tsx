"use client";

import { useEffect, useRef, useState } from "react";

import { emitAnalyticsClientEvent } from "../lib/analytics/emitClientEvent";
import { I18N_MESSAGES, type I18nKey } from "../lib/i18n/messages";

type DonateInterval = "once" | "monthly";

type DonateCheckoutPanelProps = {
  locale: "ru" | "en";
  status: "success" | "failed" | null;
  amountMinor: number | null;
  interval: DonateInterval | null;
  mock: boolean;
  preferMock: boolean;
  checkoutMode: "mock" | "external";
};

function minuteBucketIso(): string {
  return new Date().toISOString().slice(0, 16);
}

export default function DonateCheckoutPanel({
  locale,
  status,
  amountMinor,
  interval,
  mock,
  preferMock,
  checkoutMode,
}: DonateCheckoutPanelProps) {
  const t = (key: I18nKey) => I18N_MESSAGES[locale][key];
  const returnPath = locale === "ru" ? "/donate" : "/en/donate";
  const defaultAmountRub = amountMinor ? Math.max(50, Math.round(amountMinor / 100)) : 700;
  const defaultInterval: DonateInterval = interval ?? "once";
  const [amountRub, setAmountRub] = useState(defaultAmountRub);
  const [intervalValue, setIntervalValue] = useState<DonateInterval>(defaultInterval);
  const panelRef = useRef<HTMLElement | null>(null);
  const viewedRef = useRef(false);

  useEffect(() => {
    panelRef.current?.setAttribute("data-hydrated", "1");
  }, []);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    emitAnalyticsClientEvent({
      contentType: "commerce",
      contentId: "donate:funnel",
      eventType: "donate_view",
      dedupeKey: `donate-view:${locale}:${minuteBucketIso()}`,
    });
  }, [locale]);

  useEffect(() => {
    if (!status) return;
    emitAnalyticsClientEvent({
      contentType: "commerce",
      contentId: `donate:${status}:${amountMinor ?? 0}:${interval ?? "none"}`,
      eventType: status === "success" ? "donate_checkout_success" : "donate_checkout_fail",
      dedupeKey: `donate-status:${status}:${amountMinor ?? 0}:${interval ?? "none"}:${minuteBucketIso()}`,
    });
  }, [amountMinor, interval, status]);

  const emitAmountSelect = (nextAmount: number, nextInterval: DonateInterval) => {
    emitAnalyticsClientEvent({
      contentType: "commerce",
      contentId: `donate:${nextAmount}:${nextInterval}`,
      eventType: "donate_amount_select",
      dedupeKey: `donate-select:${nextAmount}:${nextInterval}:${minuteBucketIso()}`,
    });
  };

  return (
    <section
      ref={panelRef}
      className="mx-auto mt-10 max-w-3xl rounded-2xl border border-black/10 bg-white p-5 shadow-sm"
      data-testid="donate-checkout-panel"
      data-hydrated="0"
    >
      {status === "success" ? (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="donate-status-success">
          <div className="font-semibold">{t("donate.statusSuccessTitle")}</div>
          <div>{t("donate.statusSuccessBody")}</div>
          {amountMinor && interval ? (
            <div className="mt-1 text-xs text-emerald-800">
              {Math.round(amountMinor / 100)} ₽, {interval === "monthly" ? t("donate.intervalMonthly") : t("donate.intervalOnce")}
            </div>
          ) : null}
          {mock ? <div className="mt-1 text-xs text-emerald-800">{t("donate.mockHint")}</div> : null}
        </div>
      ) : null}

      {status === "failed" ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="donate-status-failed">
          <div className="font-semibold">{t("donate.statusFailedTitle")}</div>
          <div>{t("donate.statusFailedBody")}</div>
        </div>
      ) : null}

      <h2 className="text-xl font-semibold text-zinc-900">{t("donate.checkoutTitle")}</h2>
      <p className="mt-1 text-sm text-zinc-600">{t("donate.checkoutSubtitle")}</p>

      <form action="/api/donate/checkout?redirect=1" method="post" className="mt-4 space-y-4">
        <input type="hidden" name="returnPath" value={returnPath} />
        <input type="hidden" name="preferMock" value={preferMock ? "1" : "0"} />
        <input type="hidden" name="checkoutMode" value={checkoutMode} />

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-800">{t("donate.amountLabel")}</span>
          <input
            type="number"
            min={50}
            max={250000}
            step={50}
            value={amountRub}
            onChange={(event) => {
              const raw = Number(event.target.value);
              const safe = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
              setAmountRub(safe);
              emitAmountSelect(safe, intervalValue);
            }}
            name="amountRub"
            className="h-11 w-full rounded-lg border border-black/15 px-3 text-sm outline-none focus:border-[#5f82aa]"
            data-testid="donate-amount-input"
          />
        </label>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-zinc-800">{t("donate.intervalLabel")}</legend>
          <div className="grid grid-cols-2 gap-2">
            <label
              className={`flex h-11 cursor-pointer items-center justify-center rounded-lg border text-sm ${
                intervalValue === "once" ? "border-[#5f82aa] bg-[#eef4fb] text-[#264767]" : "border-black/15 bg-white text-zinc-700"
              }`}
              data-testid="donate-interval-once"
            >
              <input
                type="radio"
                name="interval"
                value="once"
                checked={intervalValue === "once"}
                onChange={() => {
                  setIntervalValue("once");
                  emitAmountSelect(amountRub, "once");
                }}
                className="sr-only"
              />
              {t("donate.intervalOnce")}
            </label>
            <label
              className={`flex h-11 cursor-pointer items-center justify-center rounded-lg border text-sm ${
                intervalValue === "monthly" ? "border-[#5f82aa] bg-[#eef4fb] text-[#264767]" : "border-black/15 bg-white text-zinc-700"
              }`}
              data-testid="donate-interval-monthly"
            >
              <input
                type="radio"
                name="interval"
                value="monthly"
                checked={intervalValue === "monthly"}
                onChange={() => {
                  setIntervalValue("monthly");
                  emitAmountSelect(amountRub, "monthly");
                }}
                className="sr-only"
              />
              {t("donate.intervalMonthly")}
            </label>
          </div>
        </fieldset>

        <button
          type="submit"
          className="h-11 rounded-lg bg-[#5f82aa] px-5 text-sm font-semibold text-white transition hover:bg-[#7398c2]"
          data-testid="donate-submit"
        >
          {t("donate.submit")}
        </button>
      </form>
    </section>
  );
}
