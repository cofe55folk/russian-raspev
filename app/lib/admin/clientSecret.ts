const ADMIN_SECRET_STORAGE_KEY = "rr_admin_api_secret";

export function readAdminSecretClient(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(ADMIN_SECRET_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function writeAdminSecretClient(secret: string): void {
  if (typeof window === "undefined") return;
  try {
    const normalized = secret.trim();
    if (!normalized) {
      window.localStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ADMIN_SECRET_STORAGE_KEY, normalized);
  } catch {}
}
