import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { TEST_DATABASE_URL } from "./database.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS "User" (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE);
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
}
