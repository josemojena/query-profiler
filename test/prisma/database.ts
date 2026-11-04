import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

export const TEST_DATABASE_URL =
  process.env.QUERY_PROFILER_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/query_profiler_test";
