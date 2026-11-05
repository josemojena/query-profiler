import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginQuery, currentScope } from "../../src/core/index.js";
import { state } from "../../src/core/state.js";
import { clearProfiles, listProfiles } from "../../src/core/storage.js";
import { profilerMiddleware } from "../../src/express/index.js";
import type { Profile } from "../../src/core/profile.js";

let server: Server | undefined;

const query = (sql: string) => {
  const scope = currentScope();
  if (scope) beginQuery(scope.profile, { sql });
};

/** An Express app whose routes record one query each, as a Prisma call would, served on a real socket. */
async function serve(options = {}, setup?: (app: Express) => void) {
  const app = express();
  setup?.(app);
  app.use(profilerMiddleware(options));
  app.use(express.json({ limit: "1mb" }));
  const orders = express.Router();
  orders.get("/:id", async (_request, response) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
    query("SELECT 1");
    response.json({ id: 1 });
  });
  orders.post("/", (request, response) => {
    query("INSERT 1");
    response.json(request.body);
  });
  app.use("/orders", orders);
  app.get("/boom", () => {
    query("SELECT 2");
    throw new Error("boom");
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearProfiles();
});
afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
  vi.unstubAllEnvs();
});

describe("the Express middleware", () => {
  it("records each request in its own profile, with the route that answered, and tags the response", async () => {
    const origin = await serve();
    const response = await fetch(`${origin}/orders/7?full=1`);
    await settled();
    const [profile] = listProfiles();
    expect(response.headers.get("X-Debug-Token")).toBe(profile!.token);
    expect(profile).toMatchObject({
      kind: "api",
      request: { method: "GET", url: "/orders/7?full=1", route: "/orders/:id" },
      response: { status: 200 },
      framework: { name: "express" },
      summary: { queryCount: 1 },
    });
  });

  it("keeps the request's context while Express parses a large body", async () => {
    const origin = await serve();
    const body = { note: "x".repeat(200_000) };
    const response = await fetch(`${origin}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(await response.json()).toEqual(body);
    await settled();
    expect(listProfiles()[0]!.queries.map((query) => query.sql)).toEqual(["INSERT 1"]);
  });

  it("keeps concurrent requests apart", async () => {
    const origin = await serve();
    await Promise.all([1, 2, 3, 4, 5].map((id) => fetch(`${origin}/orders/${id}`)));
    await settled();
    expect(listProfiles().map((profile) => profile.summary.queryCount)).toEqual([1, 1, 1, 1, 1]);
  });

  it("records a request that fails with the status Express answered", async () => {
    const origin = await serve();
    expect((await fetch(`${origin}/boom`)).status).toBe(500);
    await settled();
    expect(listProfiles()[0]).toMatchObject({
      response: { status: 500 },
      summary: { queryCount: 1 },
    });
  });

  it("tells a page from an API call, and hangs a call under the page that made it", async () => {
    const origin = await serve();
    await fetch(`${origin}/orders/1`, { headers: { Accept: "text/html" } });
    await fetch(`${origin}/orders/2`, { headers: { "X-Debug-Parent": "a1b2c3" } });
    await settled();
    expect(listProfiles().map((profile) => [profile.kind, profile.parentToken])).toEqual([
      ["api", "a1b2c3"],
      ["document", undefined],
    ]);
  });

  it("hands each profile to onProfile once the response is sent", async () => {
    const seen: Profile[] = [];
    const origin = await serve({ onProfile: (profile: Profile) => seen.push(profile) });
    await fetch(`${origin}/orders/1`);
    await settled();
    expect(seen.map((profile) => profile.request.url)).toEqual(["/orders/1"]);
  });

  it("lets a page on another origin read the token, next to the headers CORS already exposes", async () => {
    const origin = await serve({}, (app) =>
      app.use((_request, response, next) => {
        response.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
        next();
      }),
    );
    const fromPage = await fetch(`${origin}/orders/1`, { headers: { Origin: "http://app.test" } });
    expect(fromPage.headers.get("Access-Control-Expose-Headers")).toBe(
      "X-Total-Count, X-Debug-Token",
    );
    const sameOrigin = await fetch(`${origin}/orders/1`);
    expect(sameOrigin.headers.get("Access-Control-Expose-Headers")).toBe("X-Total-Count");
  });

  it("serves the profiler under its base, without profiling it", async () => {
    const origin = await serve({ base: "/_debug" });
    await fetch(`${origin}/orders/1`);
    const page = await fetch(`${origin}/_debug`);
    expect(page.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await page.text()).toContain('<query-profiler-page data-base="/_debug">');
    expect(await (await fetch(`${origin}/_debug/api/profiles`)).json()).toHaveLength(1);
    expect((await fetch(`${origin}/_debug/ui/index.js`)).headers.get("Content-Type")).toMatch(
      /^text\/javascript/,
    );
    const head = await fetch(`${origin}/_debug`, { method: "HEAD" });
    expect([head.status, await head.text()]).toEqual([200, ""]);
    expect((await fetch(`${origin}/_debug/api/profiles`, { method: "DELETE" })).status).toBe(204);
    expect(listProfiles()).toHaveLength(0);
  });

  it("stops streaming to a browser that goes away", async () => {
    const origin = await serve();
    const browser = new AbortController();
    const response = await fetch(`${origin}/_profiler/api/stream`, { signal: browser.signal });
    await response.body!.getReader().read();
    expect(state().listeners.size).toBe(1);
    browser.abort();
    await vi.waitFor(() => expect(state().listeners.size).toBe(0));
  });

  it("does nothing outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const origin = await serve();
    const response = await fetch(`${origin}/orders/1`);
    expect(response.headers.get("X-Debug-Token")).toBeNull();
    expect((await fetch(`${origin}/_profiler`)).status).toBe(404);
    await settled();
    expect(listProfiles()).toHaveLength(0);
  });
});
