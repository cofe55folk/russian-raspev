import { PrismaClient } from "@prisma/client";

declare global {
  var __rrPrismaClient: PrismaClient | undefined;
}

export const prisma =
  global.__rrPrismaClient ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__rrPrismaClient = prisma;
}
