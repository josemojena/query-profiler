import { PrismaPg } from "@prisma/adapter-pg";
import { profilePrisma, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client";

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return profilePrisma(new PrismaClient(withProfiler({ adapter })));
}

// Next reloads modules on every change in development: one client for the whole process.
const global = globalThis as { prisma?: ReturnType<typeof createClient> };
export const prisma = (global.prisma ??= createClient());
