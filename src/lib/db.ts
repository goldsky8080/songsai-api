import { PrismaClient } from "@prisma/client";

declare global {
  var __songsaiPrisma: PrismaClient | undefined;
}

export const db =
  global.__songsaiPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__songsaiPrisma = db;
}