import { execFileSync } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type UserConfig, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryProfiler } from "../../src/vite/index.js";

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
        plugins: [queryProfiler()],
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

    it("leaves every other path to the app", async () => {
      expect((await fetch(`${origin}/products`)).status).toBe(404);
    });
  });
});
