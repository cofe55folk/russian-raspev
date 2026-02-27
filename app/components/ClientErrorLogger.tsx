"use client"

import { useEffect } from "react"

const MAX_EVENTS_PER_PAGE = 40

export default function ClientErrorLogger() {
  useEffect(() => {
    let sent = 0
    const dedupe = new Map<string, number>()

    const send = (payload: {
      type: string
      message: string
      stack?: string
      source?: string
      line?: number
      column?: number
    }) => {
      if (sent >= MAX_EVENTS_PER_PAGE) return
      const key = `${payload.type}:${payload.message}:${payload.source ?? ""}:${payload.line ?? ""}:${payload.column ?? ""}`
      const now = Date.now()
      const prevAt = dedupe.get(key) ?? 0
      if (now - prevAt < 1200) return
      dedupe.set(key, now)
      sent += 1

      void fetch("/api/log/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          href: window.location.href,
          userAgent: navigator.userAgent,
          ts: new Date().toISOString(),
        }),
        keepalive: true,
      }).catch(() => {})
    }

    const onError = (event: ErrorEvent) => {
      send({
        type: "error",
        message: event.message || "window_error",
        stack: event.error?.stack || "",
        source: event.filename || "",
        line: event.lineno || 0,
        column: event.colno || 0,
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message =
        typeof reason === "string"
          ? reason
          : reason?.message
            ? String(reason.message)
            : "unhandled_rejection"
      const stack = typeof reason?.stack === "string" ? reason.stack : ""
      send({ type: "unhandledrejection", message, stack })
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandledRejection)

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
    }
  }, [])

  return null
}
