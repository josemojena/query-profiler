import { PrismaPg } from "@prisma/adapter-pg";
import { profilePrisma, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
