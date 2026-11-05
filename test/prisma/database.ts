import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");

export const TEST_DATABASE_URL =
  process.env.QUERY_PROFILER_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/query_profiler_test";

export const TEST_MYSQL_URL =
  process.env.QUERY_PROFILER_TEST_MYSQL_URL ??
  "mysql://root:root@localhost:3306/query_profiler_test";

export const TEST_MARIADB_URL =
  process.env.QUERY_PROFILER_TEST_MARIADB_URL ??
  "mariadb://root:root@localhost:3307/query_profiler_test";

export const TEST_SQLITE_URL = `file:${join(tmpdir(), "query_profiler_test.db")}`;
