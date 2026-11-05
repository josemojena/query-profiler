import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginQuery,
  clearProfiles,
  currentScope,
  listProfiles,
  type Profile,
} from "../../src/core/index.js";
import { profileRequests } from "../../src/next/requests.js";

let stop = () => {};
let server: Server;
let origin = "";

/** A plain Node server whose handler records one query a moment later, as a render would. */
async function serve(onProfile?: (profile: Profile) => void) {
  stop = profileRequests({ onProfile });
  server = createServer((request, response) => {
    setTimeout(() => {
      const scope = currentScope();
      if (scope) beginQuery(scope.profile, { sql: `SELECT ${JSON.stringify(request.url)}` });
      response.end("ok");
    }, Math.random() * 10);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearProfiles();
});
afterEach(async () => {
  stop();
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

describe("profiling the requests of a Node server from its diagnostics channel", () => {
  it("gives each request its own profile, reaching the handler after an await, and tags the response", async () => {
    await serve();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, n) => fetch(`${origin}/users?page=${n}`)),
    );
    await settled();
    const profiles = listProfiles();
    expect(profiles).toHaveLength(8);
    for (const profile of profiles)
      expect(profile.queries.map((query) => query.sql)).toEqual([
        `SELECT ${JSON.stringify(profile.request.url)}`,
      ]);
    const tokens = responses.map((response) => response.headers.get("X-Debug-Token"));
    expect(new Set(tokens)).toEqual(new Set(profiles.map((profile) => profile.token)));
  });

  it("tells pages, Next's navigations and actions, and API calls apart", async () => {
    await serve();
    await fetch(`${origin}/products`, { headers: { Accept: "text/html" } });
    await fetch(`${origin}/products?_rsc=abc`, { headers: { RSC: "1" } });
    await fetch(`${origin}/products`, { method: "POST", headers: { "Next-Action": "7f00" } });
    await fetch(`${origin}/api/users`);
    await settled();
    expect(
      listProfiles()
        .reverse()
        .map((profile) => [profile.kind, profile.request.url]),
    ).toEqual([
      ["document", "/products"],
      ["data", "/products"],
      ["action", "/products"],
      ["api", "/api/users"],
    ]);
  });

  it("hangs a call under the page that made it", async () => {
    await serve();
    await fetch(`${origin}/api/users`, { headers: { "X-Debug-Parent": "a1b2c3" } });
    await settled();
    expect(listProfiles()[0]!.parentToken).toBe("a1b2c3");
  });

  it("leaves out Next's own files and the profiler's routes", async () => {
    await serve();
    for (const path of ["/_next/static/app.js", "/favicon.ico", "/_profiler/api/profiles"])
      await fetch(`${origin}${path}`);
    await settled();
    expect(listProfiles()).toHaveLength(0);
  });

  it("hands each profile to onProfile once its response is sent, and stops when asked", async () => {
    const seen: Profile[] = [];
    await serve((profile) => seen.push(profile));
    await fetch(`${origin}/users`);
    await settled();
    expect(seen.map((profile) => profile.response?.status)).toEqual([200]);
    stop();
    await fetch(`${origin}/users`);
    await settled();
    expect(seen).toHaveLength(1);
  });
});
