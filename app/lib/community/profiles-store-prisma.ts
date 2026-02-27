import { prisma } from "../db/prisma";
import { Prisma, ProfileVisibility as PrismaProfileVisibility, UserRingStyle as PrismaUserRingStyle } from "@prisma/client";
import type { CommunityUserProfile, ProfileVisibility, UserRingStyle } from "./profiles-store";
import { ProfileHandleTakenError } from "./profiles-store";

function normalizeRingStyle(value: unknown): UserRingStyle {
  if (value === "sky") return "sky";
  if (value === "emerald") return "emerald";
  if (value === "gold") return "gold";
  return "none";
}

function normalizeVisibility(value: unknown): ProfileVisibility {
  return value === "public" ? "public" : "private";
}

function toPrismaVisibility(value: ProfileVisibility): PrismaProfileVisibility {
  return value === "public" ? PrismaProfileVisibility.public : PrismaProfileVisibility.private;
}

function normalizeHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeBio(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 500);
}

function toPrismaRingStyle(value: UserRingStyle): PrismaUserRingStyle {
  if (value === "sky") return PrismaUserRingStyle.sky;
  if (value === "emerald") return PrismaUserRingStyle.emerald;
  if (value === "gold") return PrismaUserRingStyle.gold;
  return PrismaUserRingStyle.none;
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString().slice(0, 500);
  } catch {
    return undefined;
  }
}

function toProfile(input: {
  id: string;
  userId: string;
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  visibility: PrismaProfileVisibility;
  avatarUrl: string | null;
  ringStyle: PrismaUserRingStyle;
  updatedAt: Date;
}): CommunityUserProfile {
  return {
    id: input.id,
    userId: input.userId,
    displayName: input.displayName ?? undefined,
    handle: normalizeHandle(input.handle),
    bio: normalizeBio(input.bio),
    visibility: normalizeVisibility(input.visibility),
    avatarUrl: input.avatarUrl ?? undefined,
    ringStyle: normalizeRingStyle(input.ringStyle),
    updatedAt: input.updatedAt.toISOString(),
  };
}

export async function getCommunityUserProfile(userId: string): Promise<CommunityUserProfile | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      displayName: true,
      handle: true,
      bio: true,
      visibility: true,
      avatarUrl: true,
      ringStyle: true,
      updatedAt: true,
    },
  });
  return profile ? toProfile(profile) : null;
}

export async function getCommunityUserProfileByHandle(handle: string): Promise<CommunityUserProfile | null> {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) return null;
  const profile = await prisma.userProfile.findUnique({
    where: { handle: normalizedHandle },
    select: {
      id: true,
      userId: true,
      displayName: true,
      handle: true,
      bio: true,
      visibility: true,
      avatarUrl: true,
      ringStyle: true,
      updatedAt: true,
    },
  });
  return profile ? toProfile(profile) : null;
}

export async function listCommunityUserProfilesByIds(userIds: string[]): Promise<Map<string, CommunityUserProfile>> {
  const uniqueIds = Array.from(new Set(userIds.map((item) => item.trim()).filter(Boolean)));
  const out = new Map<string, CommunityUserProfile>();
  if (!uniqueIds.length) return out;
  const profiles = await prisma.userProfile.findMany({
    where: { userId: { in: uniqueIds } },
    select: {
      id: true,
      userId: true,
      displayName: true,
      handle: true,
      bio: true,
      visibility: true,
      avatarUrl: true,
      ringStyle: true,
      updatedAt: true,
    },
  });
  for (const profile of profiles) {
    out.set(profile.userId, toProfile(profile));
  }
  return out;
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
  const displayName = params.displayName?.trim() ? params.displayName.trim().slice(0, 80) : null;
  const handle = normalizeHandle(params.handle) ?? null;
  const bio = normalizeBio(params.bio) ?? null;
  const visibility = toPrismaVisibility(normalizeVisibility(params.visibility));
  const avatarUrl = normalizeUrl(params.avatarUrl) ?? null;
  const ringStyle = normalizeRingStyle(params.ringStyle);
  try {
    const saved = await prisma.userProfile.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        displayName,
        publicName: displayName,
        handle,
        bio,
        avatarUrl,
        ringStyle: toPrismaRingStyle(ringStyle),
        visibility,
        schemaVersion: 1,
      },
      update: {
        displayName,
        publicName: displayName,
        handle,
        bio,
        avatarUrl,
        ringStyle: toPrismaRingStyle(ringStyle),
        visibility: params.visibility === undefined ? undefined : visibility,
      },
      select: {
        id: true,
        userId: true,
        displayName: true,
        handle: true,
        bio: true,
        visibility: true,
        avatarUrl: true,
        ringStyle: true,
        updatedAt: true,
      },
    });
    return toProfile(saved);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ProfileHandleTakenError();
    }
    throw error;
  }
}
