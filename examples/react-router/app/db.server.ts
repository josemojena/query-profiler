import { PrismaPg } from "@prisma/adapter-pg";
import { profilerExtension, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient(withProfiler({ adapter })).$extends(profilerExtension);
