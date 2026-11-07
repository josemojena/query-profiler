import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  beginOperation,
  beginQuery,
  endProfile,
  finishOperation,
  finishQuery,
  startProfile,
} from "../../src/core/recorder.js";
import { clearProfiles } from "../../src/core/storage.js";
import { profilerServer } from "../../src/node/server.js";

let server: Server;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "development");
  server = profilerServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  url = `http://localhost:${(server.address() as AddressInfo).port}/_profiler/mcp`;
});
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});
beforeEach(() => clearProfiles());
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

async function connect() {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  clients.push(client);
  return client;
}

/** What a tool answered, as the JSON it sent. */
async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return result.structuredContent as T;
}

/** A page that counts each of six users' posts, one by one, as the React Router example's home does. */
function homePage() {
  const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
  const origin = (line: number) => [{ file: `${process.cwd()}/app/routes/home.tsx`, line }];
  const users = beginOperation(active, {
    model: "User",
    action: "findMany",
    args: { take: 6 },
    origin: origin(6),
  });
  finishQuery(
    active,
    beginQuery(active, {
      sql: 'SELECT "id" FROM "User" LIMIT $1',
      params: [6],
      opIds: [users.id],
    })!,
    undefined,
    { rows: 6 },
  );
  finishOperation(active, users);
  for (let id = 1; id <= 6; id += 1) {
    const count = beginOperation(active, {
      model: "Post",
      action: "count",
      args: { where: { authorId: id } },
      origin: origin(8),
    });
    const sql = 'SELECT COUNT(*) FROM "Post" WHERE "authorId" = $1';
    finishQuery(active, beginQuery(active, { sql, params: [id], opIds: [count.id] })!, undefined, {
      rows: 1,
    });
    finishOperation(active, count);
  }
  return endProfile(active, { status: 200 });
}

it("offers its tools, read-only but for the index trial, with instructions for the agent", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    "list_requests",
    "get_request",
    "fix_n1",
    "explain_query",
    "try_index",
    "analyze_session",
    "get_stats",
  ]);
  expect(tools.filter((tool) => !tool.annotations?.readOnlyHint).map((tool) => tool.name)).toEqual([
    "try_index",
  ]);
  expect(client.getInstructions()).toContain("Start with list_requests");
});

it("lists the recorded requests, newest first, and filters them", async () => {
  const quiet = startProfile({ method: "GET", url: "/about", kind: "document" }, { name: "test" });
  endProfile(quiet, { status: 200 });
  const home = homePage();
  const client = await connect();
  const { requests } = await call<{
    requests: { token: string; request: string; warnings: string[] }[];
  }>(client, "list_requests");
  expect(requests.map((each) => [each.request, each.warnings])).toEqual([
    ["GET /", ["n+1"]],
    ["GET /about", []],
  ]);
  const flagged = await call<{ requests: { token: string }[] }>(client, "list_requests", {
    warnings: true,
  });
  expect(flagged.requests.map((each) => each.token)).toEqual([home.token]);
});

it("gives one request whole, each query with its rows and its line from the project's root", async () => {
  const home = homePage();
  const client = await connect();
  const profile = await call<{
    queries: { id: string; rows: number; line: string }[];
    operations: { call: string; args: unknown }[];
  }>(client, "get_request", { token: home.token });
  expect(profile.queries[1]).toMatchObject({ rows: 1, line: "app/routes/home.tsx:8" });
  expect(profile.operations[1]).toMatchObject({
    call: "Post.count",
    args: { where: { authorId: 1 } },
  });
});

it("gives the code that replaces an N+1, once for the call", async () => {
  const home = homePage();
  const client = await connect();
  const { fixes } = await call<{
    fixes: { operation: string; line: string; changing: unknown; options: { code: string }[] }[];
  }>(client, "fix_n1", { token: home.token });
  expect(fixes).toHaveLength(1);
  expect(fixes[0]).toMatchObject({
    operation: "Post.count",
    line: "app/routes/home.tsx:8",
    changing: { argument: "authorId", values: [1, 2, 3, 4, 5, 6], count: 6 },
  });
  expect(fixes[0]!.options.map((option) => option.code).join("\n")).toContain(
    "prisma.post.groupBy(",
  );
});

it("says what it cannot do instead of failing: a profile gone, a query with no connection to ask", async () => {
  const home = homePage();
  const client = await connect();
  const gone = await client.callTool({ name: "get_request", arguments: { token: "abcdef" } });
  expect(gone).toMatchObject({ isError: true });
  const explain = await client.callTool({
    name: "explain_query",
    arguments: { token: home.token, query: "q_2" },
  });
  expect(explain).toMatchObject({ isError: true });
  expect(JSON.stringify(explain.content)).toContain("The connection that ran this query is gone");
});

it("adds up the stored requests", async () => {
  homePage();
  const client = await connect();
  const stats = await call<{ profiles: number; models: { model: string }[] }>(client, "get_stats");
  expect(stats.profiles).toBe(1);
  expect(stats.models.map((model) => model.model).sort()).toEqual(["Post", "User"]);
});

it("turns away a page of another site, and answers clients of the 2025 protocol", async () => {
  const initialize = (headers: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "old", version: "1" },
        },
      }),
    });
  expect((await initialize({ Origin: "https://evil.example" })).status).toBe(403);
  const answer = await initialize();
  expect(answer.status).toBe(200);
  expect(await answer.text()).toContain('"name":"query-profiler"');
});
