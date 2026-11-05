import { execFileSync } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type Plugin, type UserConfig, type ViteDevServer } from "vite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { beginQuery, clearProfiles, currentScope, listProfiles } from "../../src/core/index.js";
import { queryProfiler } from "../../src/vite/index.js";

// Stands in for React Router's handler: it answers after Vite's own middleware, and makes a query.
const app: Plugin = {
  name: "app",
  configureServer: (server) => () =>
    server.middlewares.use((request, response) => {
      setTimeout(() => {
        const scope = currentScope();
        if (scope) beginQuery(scope.profile, { sql: `SELECT ${JSON.stringify(request.url)}` });
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>app</title>");
      }, 1);
    }),
};

const transform = (plugin: Plugin, command: "serve" | "build", id: string, ssr = false) => {
  (plugin.configResolved as (config: { command: string }) => void)({ command });
  return (plugin.transform as (code: string, id: string, options: { ssr: boolean }) => unknown)(
    "hydrateRoot(document, app);",
    id,
    { ssr },
  );
};

describe("the Vite plugin", () => {
  it("loads in plain Node, as Vite loads a config file", () => {
    const output = execFileSync(process.execPath, [
      "--input-type=module",
      "--eval",
      'const { queryProfiler } = await import("query-profiler/vite"); console.log(queryProfiler().name);',
    ]);
    expect(output.toString().trim()).toBe("query-profiler");
  });

  it("keeps the profiler inside the server bundle", () => {
    const config = (queryProfiler().config as () => UserConfig)();
    expect(config.ssr?.noExternal).toEqual([/^query-profiler(\/|$)/]);
  });

  describe("in the dev server", () => {
    let vite: ViteDevServer;
    let http: Server;
    let origin: string;

    beforeAll(async () => {
      vi.stubEnv("NODE_ENV", "development");
      vite = await createServer({
        configFile: false,
        logLevel: "silent",
        appType: "custom",
        plugins: [queryProfiler(), app],
        server: { middlewareMode: true, hmr: false },
      });
      http = createHttpServer(vite.middlewares);
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      origin = `http://localhost:${(http.address() as AddressInfo).port}`;
    }, 30_000);
    afterAll(async () => {
      http.close();
      await vite.close();
      vi.unstubAllEnvs();
    });

    it("serves the profiler API", async () => {
      const response = await fetch(`${origin}/_profiler/api/profiles`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expect.any(Array));
    });

    it("serves the bar's code as a module Vite compiles", async () => {
      const redirect = await fetch(`${origin}/_profiler/ui.js`, { redirect: "manual" });
      expect(redirect.status).toBe(302);
      const module = await fetch(`${origin}${redirect.headers.get("Location")}`);
      expect(module.headers.get("Content-Type")).toMatch(/javascript/);
      expect(await module.text()).toMatch(/import ".*dist\/ui\/index\.js"/);
    });

    beforeEach(() => clearProfiles());

    const stored = () =>
      vi.waitFor(() => {
        expect(listProfiles().length).toBeGreaterThan(0);
        return listProfiles();
      });

    it("profiles each request the app answers, and tells the page its token in Server-Timing", async () => {
      const response = await fetch(`${origin}/products?page=2`, {
        headers: { Accept: "text/html" },
      });
      expect(await response.text()).toContain("<title>app</title>");
      const [profile] = await stored();
      expect(profile).toMatchObject({
        kind: "document",
        request: { method: "GET", url: "/products?page=2" },
        summary: { queryCount: 1 },
      });
      expect(response.headers.get("X-Debug-Token")).toBe(profile!.token);
      expect(response.headers.get("Server-Timing")).toBe(`query-profiler;desc="${profile!.token}"`);
    });

    it("tells data requests, actions and the calls a page made apart", async () => {
      await fetch(`${origin}/_.data`, { headers: { "X-Debug-Parent": "a1b2c3" } });
      await fetch(`${origin}/products`, { method: "POST" });
      await vi.waitFor(() => expect(listProfiles()).toHaveLength(2));
      expect(
        listProfiles()
          .reverse()
          .map((profile) => [profile.kind, profile.request.url, profile.parentToken]),
      ).toEqual([
        ["data", "/", "a1b2c3"],
        ["action", "/products", undefined],
      ]);
    });

    it("leaves Vite's own requests alone", async () => {
      const client = await fetch(`${origin}/@vite/client`);
      expect(client.headers.get("X-Debug-Token")).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(listProfiles()).toHaveLength(0);
    });
  });

  describe("the bar", () => {
    const ENTRIES = [
      "/app/node_modules/@react-router/dev/dist/config/defaults/entry.client.tsx",
      "/app/app/entry.client.tsx",
    ];

    it("comes in first through React Router's client entry, in development", () => {
      for (const id of ENTRIES)
        expect(transform(queryProfiler(), "serve", id)).toEqual({
          code: 'import "virtual:query-profiler/bar";hydrateRoot(document, app);',
          map: null,
        });
    });

    it("stays out of the server's code, of any other module, and of builds", () => {
      expect(transform(queryProfiler(), "serve", ENTRIES[0]!, true)).toBeUndefined();
      expect(transform(queryProfiler(), "serve", "/app/app/root.tsx")).toBeUndefined();
      expect(transform(queryProfiler(), "build", ENTRIES[0]!)).toBeUndefined();
    });

    it("reads the page's token from Server-Timing when the page gives none", () => {
      const plugin = queryProfiler({ base: "/_debug" });
      const load = plugin.load as (id: string) => string | undefined;
      const code = load("\0virtual:query-profiler/bar")!;
      expect(code).toContain('"base":"/_debug"');
      expect(code).toContain('"timing":"query-profiler"');
      expect(code).toContain("serverTiming");
    });
  });
});
