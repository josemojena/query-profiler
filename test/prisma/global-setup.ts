import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { dropAnalysisFixture } from "./analysis-fixture.js";
import {
  TEST_DATABASE_URL,
  TEST_MARIADB_URL,
  TEST_MYSQL_URL,
  TEST_SQLITE_URL,
} from "./database.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS "User" (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password TEXT;
  CREATE TABLE IF NOT EXISTS "Order" (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES "User"(id),
    total INTEGER NOT NULL,
    status TEXT NOT NULL
  );`;

export default async function setup() {
  const database = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!database.endsWith("_test"))
    throw new Error(`Refusing to use "${database}": not a _test database`);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = "/postgres";
  const server = new pg.Client({ connectionString: admin.toString() });
  await server.connect();
  const exists = await server.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  if (exists.rowCount === 0) await server.query(`CREATE DATABASE "${database}"`);
  await server.end();

  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(SCHEMA);
  await client.end();

  const config = path.join(import.meta.dirname, "fixture", "prisma.config.ts");
  execFileSync("npx", ["prisma", "generate", "--config", config], { stdio: "pipe" });

  // MySQL, MariaDB and SQLite get the same tables from their own schema.
  for (const [fixture, url] of [
    ["fixture-mysql", TEST_MYSQL_URL],
    ["fixture-mysql", TEST_MARIADB_URL],
    ["fixture-sqlite", TEST_SQLITE_URL],
  ] as const) {
    if (!url.startsWith("file:") && !new URL(url).pathname.endsWith("_test"))
      throw new Error(`Refusing to use "${url}": not a _test database`);
    const schema = path.join(import.meta.dirname, fixture, "prisma.config.ts");
    const env = { ...process.env, DATABASE_URL: url.replace(/^mariadb:/, "mysql:") };
    // db push drops tables its schema lacks, and refuses when they hold rows: the analysis tests'
    // tables, if a run stopped before removing them. A database not created yet has none.
    try {
      execFileSync("npx", ["prisma", "db", "execute", "--config", schema, "--stdin"], {
        input: dropAnalysisFixture().join(";\n"),
        stdio: "pipe",
        env,
      });
    } catch {}
    execFileSync("npx", ["prisma", "db", "push", "--config", schema], {
      stdio: "pipe",
      env,
    });
    execFileSync("npx", ["prisma", "generate", "--config", schema], { stdio: "pipe", env });
  }
}
