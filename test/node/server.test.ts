import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfiles, listProfiles } from "../../src/core/index.js";
import { profileRequests } from "../../src/node/requests.js";
import { profilerServer } from "../../src/node/server.js";

const servers: Server[] = [];
let stop = () => {};

/** A free port, found by listening on port 0 and letting it go. */
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "localhost", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const ready = () =>
  new Promise<string>((resolve) => servers.push(profilerServer((url) => resolve(url))));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearProfiles();
});
afterEach(async () => {
  stop();
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  vi.unstubAllEnvs();
});

describe("the profiler on a port of its own", () => {
  it("serves its page and API on QUERY_PROFILER_PORT, without profiling its own requests", async () => {
    const port = await freePort();
    vi.stubEnv("QUERY_PROFILER_PORT", String(port));
    const url = await ready();
    expect(url).toBe(`http://localhost:${port}/_profiler`);
    stop = profileRequests({ skip: servers[0] });
    const page = await fetch(url);
    expect(page.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await (await fetch(`${url}/api/profiles`)).json()).toEqual([]);
    expect(listProfiles()).toHaveLength(0);
  });

  it("waits for its port when a restarting app still holds it", async () => {
    const port = await freePort();
    vi.stubEnv("QUERY_PROFILER_PORT", String(port));
    const previous = createServer();
    await new Promise<void>((resolve) => previous.listen(port, "localhost", resolve));
    const url = ready();
    setTimeout(() => previous.close(), 300);
    expect(await url).toBe(`http://localhost:${port}/_profiler`);
    expect((await fetch(await url)).status).toBe(200);
  });
});
