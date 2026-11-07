import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { endProfile, runWithProfile, startProfile, type Profile } from "../../src/core/index.js";
import { profilerServer } from "../../src/node/server.js";
import { profilePrisma } from "../../src/prisma/index.js";
import { analysisFixture, dropAnalysisFixture } from "./analysis-fixture.js";
import { ENGINES } from "./engines.js";

const [, connect] = ENGINES.find(([engine]) => engine === "postgres")!;
const prisma = profilePrisma(connect());
let server: Server;
let client: Client;
let profile: Profile;

beforeAll(async () => {
  for (const sql of [...dropAnalysisFixture(), ...analysisFixture("postgres")])
    await prisma.$executeRawUnsafe(sql);
  const active = startProfile({ method: "GET", url: "/posts", kind: "document" }, { name: "test" });
  await runWithProfile(active, async () => {
    await prisma.$queryRawUnsafe("SELECT id FROM qp_post WHERE title = $1", "Post 7");
  });
  profile = endProfile(active, { status: 200 });
  server = profilerServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/_profiler/mcp`)),
  );
}, 60_000);
afterAll(async () => {
  await client.close();
  server.close();
  for (const sql of dropAnalysisFixture()) await prisma.$executeRawUnsafe(sql);
  await prisma.$disconnect();
});

async function call<T>(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result.structuredContent as T;
}

const query = () => profile.queries.at(-1)!.id;

it("explains a query through the connection that ran it: its plan, tables and the index to add", async () => {
  const analysis = await call<{
    engine: string;
    measured: boolean;
    tables: { name: string; indexes: unknown[] }[];
    findings: { rule: string; fix: { index: string; prisma: string } }[];
  }>("explain_query", { token: profile.token, query: query() });
  expect(analysis).toMatchObject({ engine: "postgres", measured: false });
  expect(analysis.tables.map((table) => table.name)).toEqual(["qp_post"]);
  expect(analysis.findings[0]).toMatchObject({
    rule: "full-scan-missing-index",
    fix: { index: "qp_post_title_idx" },
  });
});

it("measures it when asked, in a transaction that is rolled back", async () => {
  const analysis = await call<{ measured: boolean }>("explain_query", {
    token: profile.token,
    query: query(),
    measure: true,
  });
  expect(analysis.measured).toBe(true);
});

it("tries the suggested index, and refuses one it did not suggest", async () => {
  expect(
    await call("try_index", { token: profile.token, query: query(), index: "qp_post_title_idx" }),
  ).toMatchObject({ index: "qp_post_title_idx", used: true });
  const other = await client.callTool({
    name: "try_index",
    arguments: { token: profile.token, query: query(), index: "qp_post_views_a" },
  });
  expect(other).toMatchObject({ isError: true });
});

it("analyzes the session: the indexes that fix the most", async () => {
  const session = await call<{ indexes: { name: string }[] }>("analyze_session");
  expect(session.indexes.map((pick) => pick.name)).toContain("qp_post_title_idx");
});
