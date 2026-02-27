import type { CommunityUserProfile, ProfileVisibility, UserRingStyle } from "./profiles-store";

export type { CommunityUserProfile, ProfileVisibility, UserRingStyle } from "./profiles-store";
export { ProfileHandleTakenError } from "./profiles-store";

type StoreModule = {
  getCommunityUserProfile(userId: string): Promise<CommunityUserProfile | null>;
  getCommunityUserProfileByHandle(handle: string): Promise<CommunityUserProfile | null>;
  listCommunityUserProfilesByIds(userIds: string[]): Promise<Map<string, CommunityUserProfile>>;
  upsertCommunityUserProfile(params: {
    userId: string;
    displayName?: string;
    handle?: string;
    bio?: string;
    visibility?: ProfileVisibility;
    avatarUrl?: string;
    ringStyle?: UserRingStyle;
  }): Promise<CommunityUserProfile>;
};

type StoreMode = "file" | "prisma";

const preferPrisma = process.env.RR_COMMUNITY_STORE === "prisma" && !!process.env.DATABASE_URL;
let backendPromise: Promise<StoreModule> | null = null;

function getDesiredStoreMode(): StoreMode {
  return preferPrisma ? "prisma" : "file";
}

async function loadBackend(): Promise<StoreModule> {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    if (getDesiredStoreMode() === "prisma") {
      try {
        return (await import("./profiles-store-prisma")) as StoreModule;
      } catch (error) {
        console.warn("[community-profiles] Prisma backend unavailable, fallback to file backend.", error);
      }
    }
    return (await import("./profiles-store")) as StoreModule;
  })();
  return backendPromise;
}

async function callStore<K extends keyof StoreModule>(
  method: K,
  ...args: Parameters<StoreModule[K]>
): Promise<Awaited<ReturnType<StoreModule[K]>>> {
  const backend = await loadBackend();
  const fn = backend[method] as (...methodArgs: Parameters<StoreModule[K]>) => ReturnType<StoreModule[K]>;
  return await fn(...args);
}

export function getCommunityProfilesStoreMode(): StoreMode {
  return getDesiredStoreMode();
}

export async function getCommunityUserProfile(userId: string): Promise<CommunityUserProfile | null> {
  return callStore("getCommunityUserProfile", userId);
}

export async function getCommunityUserProfileByHandle(handle: string): Promise<CommunityUserProfile | null> {
  return callStore("getCommunityUserProfileByHandle", handle);
}

export async function listCommunityUserProfilesByIds(
  userIds: string[]
): Promise<Map<string, CommunityUserProfile>> {
  return callStore("listCommunityUserProfilesByIds", userIds);
}

export async function upsertCommunityUserProfile(params: {
  userId: string;
  displayName?: string;
  handle?: string;
  bio?: string;
  visibility?: ProfileVisibility;
  avatarUrl?: string;
  ringStyle?: UserRingStyle;
}): Promise<CommunityUserProfile> {
  return callStore("upsertCommunityUserProfile", params);
}
