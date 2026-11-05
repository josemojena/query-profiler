import type { AddressInfo } from "node:net";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginQuery, currentScope } from "../../src/core/index.js";
import { clearProfiles, listProfiles } from "../../src/core/storage.js";
import { state } from "../../src/core/state.js";
import { profilerPlugin } from "../../src/fastify/index.js";
import type { Profile } from "../../src/core/profile.js";

/** A Fastify app whose routes record one query each, as a Prisma call would. */
async function app(options = {}) {
  const server = Fastify();
  await server.register(profilerPlugin, options);
  const query = (sql: string) => {
    const scope = currentScope();
    if (scope) beginQuery(scope.profile, { sql });
  };
  server.get("/orders/:id", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    query("SELECT 1");
    return { id: 1 };
  });
  server.post("/orders", async (request) => {
    query("INSERT 1");
    return request.body;
  });
  server.get("/boom", async () => {
    query("SELECT 2");
    throw new Error("boom");
  });
  return server;
}

const listeners = () => state().listeners.size;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearProfiles();
});
afterEach(() => vi.unstubAllEnvs());

describe("the Fastify plugin", () => {
  it("records each request in its own profile, with its route, and tags the response with its token", async () => {
    const server = await app();
    const response = await server.inject({ method: "GET", url: "/orders/7?full=1" });
    const [profile] = listProfiles();
    expect(response.headers["x-debug-token"]).toBe(profile!.token);
    expect(profile).toMatchObject({
      kind: "api",
      request: { method: "GET", url: "/orders/7?full=1", route: "/orders/:id" },
      response: { status: 200 },
      framework: { name: "fastify", version: server.version },
      summary: { queryCount: 1 },
    });
  });

  it("keeps the request's context while Fastify reads a large body from the socket", async () => {
    const server = await app();
    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    const body = { note: "x".repeat(200_000) };
    const response = await fetch(`http://127.0.0.1:${port}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(await response.json()).toEqual(body);
    expect(listProfiles()[0]!.queries.map((query) => query.sql)).toEqual(["INSERT 1"]);
    await server.close();
  });

  it("keeps concurrent requests apart", async () => {
    const server = await app();
    await Promise.all([1, 2, 3].map((id) => server.inject(`/orders/${id}`)));
    expect(listProfiles().map((profile) => profile.summary.queryCount)).toEqual([1, 1, 1]);
  });

  it("records a request that fails with the status Fastify answered", async () => {
    const server = await app();
    expect((await server.inject("/boom")).statusCode).toBe(500);
    expect(listProfiles()[0]).toMatchObject({
      response: { status: 500 },
      summary: { queryCount: 1 },
    });
  });

  it("hands each profile to onProfile once the response is sent", async () => {
    const seen: Profile[] = [];
    const server = await app({ onProfile: (profile: Profile) => seen.push(profile) });
    await server.inject("/orders/1");
    expect(seen.map((profile) => profile.request.url)).toEqual(["/orders/1"]);
  });

  it("hangs a call under the page that made it", async () => {
    const server = await app();
    await server.inject({ url: "/orders/1", headers: { "x-debug-parent": "a1b2c3" } });
    await server.inject({ url: "/orders/2", headers: { "x-debug-parent": "not a token" } });
    expect(listProfiles().map((profile) => profile.parentToken)).toEqual([undefined, "a1b2c3"]);
  });

  it("lets a page on another origin read the token, next to the headers CORS already exposes", async () => {
    const server = Fastify();
    server.addHook("onRequest", async (_request, reply) => {
      reply.header("Access-Control-Expose-Headers", "X-Total-Count");
    });
    await server.register(profilerPlugin);
    server.get("/orders", async () => []);
    const fromPage = await server.inject({
      url: "/orders",
      headers: { origin: "http://app.test" },
    });
    expect(fromPage.headers["access-control-expose-headers"]).toBe("X-Total-Count, X-Debug-Token");
    const sameOrigin = await server.inject("/orders");
    expect(sameOrigin.headers["access-control-expose-headers"]).toBe("X-Total-Count");
  });

  it("serves the profiler under its base, without profiling it", async () => {
    const server = await app({ base: "/_debug" });
    await server.inject("/orders/1");
    const page = await server.inject("/_debug");
    expect(page.headers["content-type"]).toMatch(/^text\/html/);
    expect(page.body).toContain('<query-profiler-page data-base="/_debug">');
    const list = await server.inject("/_debug/api/profiles");
    expect(list.json()).toHaveLength(1);
    expect((await server.inject("/_debug/ui/index.js")).headers["content-type"]).toMatch(
      /^text\/javascript/,
    );
    expect(
      (await server.inject({ method: "DELETE", url: "/_debug/api/profiles" })).statusCode,
    ).toBe(204);
    expect(listProfiles()).toHaveLength(0);
  });

  it("stops streaming to a browser that goes away", async () => {
    const server = await app();
    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    const browser = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/_profiler/api/stream`, {
      signal: browser.signal,
    });
    await response.body!.getReader().read();
    expect(listeners()).toBe(1);
    browser.abort();
    await vi.waitFor(() => expect(listeners()).toBe(0));
    await server.close();
  });

  it("does nothing outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const server = await app();
    const response = await server.inject("/orders/1");
    expect(response.headers["x-debug-token"]).toBeUndefined();
    expect((await server.inject("/_profiler")).statusCode).toBe(404);
    expect(listProfiles()).toHaveLength(0);
  });
});
