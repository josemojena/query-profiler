import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfiles, listProfiles } from "../../src/core/index.js";
import { state } from "../../src/core/state.js";
import { profileRequests } from "../../src/node/requests.js";
import { profilerServer } from "../../src/node/server.js";

const servers: Server[] = [];
let stop = () => {};

const listening = (server: Server) =>
  new Promise<void>((resolve) => server.listen(0, "localhost", resolve));

/** A free port, found by listening on port 0 and letting it go. */
async function freePort() {
  const probe = createServer();
  await listening(probe);
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Another program holding `port` until it is closed. */
async function holder(port: number) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, "localhost", resolve));
  servers.push(server);
  return server;
}

const start = (port?: number) =>
  new Promise<string>((resolve) => servers.push(profilerServer({ port, onListening: resolve })));

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
    const url = await start();
    expect(url).toBe(`http://localhost:${port}/_profiler`);
    const own = servers[0];
    stop = profileRequests({ skip: (server) => server === own });
    const page = await fetch(url);
    expect(page.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await (await fetch(`${url}/api/profiles`)).json()).toEqual([]);
    expect(listProfiles()).toHaveLength(0);
  });

  it("waits for its port while a restarting app still holds it", async () => {
    const port = await freePort();
    const previous = await holder(port);
    const url = start(port);
    setTimeout(() => previous.close(), 300);
    expect(await url).toBe(`http://localhost:${port}/_profiler`);
    expect((await fetch(await url)).status).toBe(200);
  });

  it("answers HEAD like GET, without a body", async () => {
    const url = await start(0);
    const page = await fetch(url, { method: "HEAD" });
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await page.text()).toBe("");
  });

  it("stops streaming to a browser that goes away", async () => {
    const url = await start(0);
    const browser = new AbortController();
    const stream = await fetch(`${url}/api/stream`, { signal: browser.signal });
    await stream.body!.getReader().read();
    expect(state().listeners.size).toBe(1);
    browser.abort();
    await vi.waitFor(() => expect(state().listeners.size).toBe(0));
  });

  it("moves to the next port when another program keeps its own", async () => {
    const port = await freePort();
    await holder(port);
    const url = await start(port);
    expect(Number(new URL(url).port)).toBeGreaterThan(port);
    expect((await fetch(url)).status).toBe(200);
  });
});

describe("the requests profiled", () => {
  let app: Server;
  let origin = "";
  beforeEach(async () => {
    stop = profileRequests();
    app = createServer((request, response) => {
      response.statusCode = request.url === "/boom" ? 500 : 200;
      response.end("ok");
    });
    servers.push(app);
    await listening(app);
    origin = `http://localhost:${(app.address() as AddressInfo).port}`;
  });

  it("are tagged with their token, and the token is readable from other origins", async () => {
    const response = await fetch(`${origin}/orders`, {
      headers: { Origin: "http://spa.example", Accept: "text/html" },
    });
    const token = response.headers.get("X-Debug-Token");
    expect(token).toMatch(/^[0-9a-f]{6}$/);
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Debug-Token");
    await vi.waitFor(() =>
      expect(listProfiles()).toMatchObject([
        { token, kind: "document", request: { method: "GET", url: "/orders" } },
      ]),
    );
  });

  it("keep the status the app answered, a failure too", async () => {
    await fetch(`${origin}/boom`);
    await vi.waitFor(() => expect(listProfiles()).toMatchObject([{ response: { status: 500 } }]));
  });

  it("hang under the page that made them", async () => {
    await fetch(`${origin}/api/offers`, { headers: { "X-Debug-Parent": "a1b2c3" } });
    await vi.waitFor(() =>
      expect(listProfiles()).toMatchObject([{ kind: "api", parentToken: "a1b2c3" }]),
    );
  });

  it("leave out what browsers ask for on their own", async () => {
    await fetch(`${origin}/favicon.ico`);
    await fetch(`${origin}/.well-known/appspecific/com.chrome.devtools.json`);
    await fetch(`${origin}/users`);
    await vi.waitFor(() => expect(listProfiles()).toHaveLength(1));
    expect(listProfiles()[0]!.request.url).toBe("/users");
  });
});
