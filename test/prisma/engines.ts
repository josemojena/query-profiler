import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Engine } from "../../src/analysis/plan.js";
import { withProfiler } from "../../src/prisma/index.js";
import {
  TEST_DATABASE_URL,
  TEST_MARIADB_URL,
  TEST_MYSQL_URL,
  TEST_SQLITE_URL,
} from "./database.js";
import { PrismaClient as PostgresClient } from "./fixture/generated/client.js";
import { PrismaClient as MySqlClient } from "./fixture-mysql/generated/client.js";
import { PrismaClient as SqliteClient } from "./fixture-sqlite/generated/client.js";

/** The generated clients have the same models: one type keeps the tests the same for each engine. */
export type Client = MySqlClient;

// The mariadb driver speaks to MySQL too; MySQL 8's default login asks for the server's key.
const mariadb = (url: string) =>
  new PrismaMariaDb(`${url.replace(/^mysql:/, "mariadb:")}?allowPublicKeyRetrieval=true`);

/** A profiled client for each engine the tests run against. */
export const ENGINES: [Engine, () => Client][] = [
  [
    "postgres",
    () =>
      new PostgresClient(
        withProfiler({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) }),
      ) as unknown as Client,
  ],
  ["mysql", () => new MySqlClient(withProfiler({ adapter: mariadb(TEST_MYSQL_URL) }))],
  ["mariadb", () => new MySqlClient(withProfiler({ adapter: mariadb(TEST_MARIADB_URL) }))],
  [
    "sqlite",
    () =>
      new SqliteClient(
        withProfiler({ adapter: new PrismaBetterSqlite3({ url: TEST_SQLITE_URL }) }),
      ) as unknown as Client,
  ],
];
