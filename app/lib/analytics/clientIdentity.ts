const VISITOR_KEY = "rr_visitor_id_v1";
const SESSION_KEY = "rr_analytics_session_v1";

export function ensureVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY)?.trim();
    if (existing) return existing;
    const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(VISITOR_KEY, next);
    return next;
  } catch {
    return "anonymous";
  }
}

export function ensureAnalyticsSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY)?.trim();
    if (existing) return existing;
    const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return "session-anonymous";
  }
}
