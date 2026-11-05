import {
  beginQuery,
  clearProfiles,
  currentScope,
  listProfiles,
  type Profile,
} from "../../src/core/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profilerMiddleware, TOKEN_HEADER } from "../../src/react-router/middleware.js";

type Args = Parameters<ReturnType<typeof profilerMiddleware>>[0];
const call = (url: string, init?: RequestInit) => ({ request: new Request(url, init) }) as Args;

function queryNow(sql: string) {
  const scope = currentScope();
  if (scope) beginQuery(scope.profile, { sql });
}

let profiles: Profile[];
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  profiles = [];
});
afterEach(() => vi.unstubAllEnvs());

const middleware = () => profilerMiddleware({ onProfile: (profile) => profiles.push(profile) });

describe("profilerMiddleware", () => {
  it("profiles a document request and tags the response with its token", async () => {
    const response = (await middleware()(call("http://localhost/orders?page=2"), async () => {
      queryNow("SELECT 1");
      return new Response(null, { status: 200 });
    })) as Response;
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      kind: "document",
      request: { method: "GET", url: "/orders?page=2" },
      response: { status: 200 },
      framework: { name: "react-router" },
      summary: { queryCount: 1 },
    });
    expect(response.headers.get(TOKEN_HEADER)).toBe(profiles[0]!.token);
  });

  it("stores each profile for the bar and the profiler page, with no options at all", async () => {
    clearProfiles();
    const response = (await profilerMiddleware()(call("http://localhost/orders"), async () => {
      queryNow("SELECT 1");
      return new Response("orders");
    })) as Response;
    await response.text();
    const [stored] = listProfiles();
    expect(stored).toMatchObject({ request: { url: "/orders" }, summary: { queryCount: 1 } });
    expect(response.headers.get(TOKEN_HEADER)).toBe(stored!.token);
  });

  it("shows a data request as the route it loads", async () => {
    const ok = async () => new Response(null);
    await middleware()(
      call("http://localhost/orders/offers.data?_routes=routes%2Foffers&page=2"),
      ok,
    );
    await middleware()(call("http://localhost/_root.data?_routes=root"), ok);
    expect(profiles.map((profile) => profile.request.url)).toEqual(["/orders/offers?page=2", "/"]);
  });

  it("tells data requests and actions apart", async () => {
    const ok = async () => new Response(null);
    await middleware()(call("http://localhost/orders.data"), ok);
    await middleware()(call("http://localhost/orders", { method: "POST" }), ok);
    const singleFetch = async () =>
      new Response("[]", {
        headers: { "Content-Type": "text/x-script", "X-Remix-Response": "yes" },
      });
    await ((await middleware()(call("http://localhost/orders"), singleFetch)) as Response).text();
    expect(profiles.map((profile) => profile.kind)).toEqual(["data", "action", "data"]);
  });

  it("waits for a streamed body to be sent, keeping what runs meanwhile", async () => {
    const encoder = new TextEncoder();
    const response = (await middleware()(call("http://localhost/"), async () => {
      const body = new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          queryNow("SELECT deferred");
          controller.enqueue(encoder.encode("<html>"));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    })) as Response;
    expect(profiles).toEqual([]);
    expect(await response.text()).toBe("<html>");
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.queries.map((query) => query.sql)).toEqual(["SELECT deferred"]);
  });

  it("ends when the browser stops reading", async () => {
    const response = (await middleware()(call("http://localhost/"), async () => {
      return new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }));
    })) as Response;
    await response.body!.cancel();
    expect(profiles).toHaveLength(1);
  });

  it("ends with the status of a thrown response, or 500, and lets it through", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/login" } });
    await expect(
      middleware()(call("http://localhost/"), () => Promise.reject(redirect)),
    ).rejects.toBe(redirect);
    await expect(
      middleware()(call("http://localhost/"), () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(profiles.map((profile) => profile.response?.status)).toEqual([302, 500]);
  });

  it("adds the bar to HTML pages, before </body>, even split across chunks", async () => {
    const encoder = new TextEncoder();
    const response = (await middleware()(call("http://localhost/products"), async () => {
      const body = new ReadableStream({
        start(controller) {
          for (const part of ["<html><body><h1>Products</h1></bo", "dy></html>"])
            controller.enqueue(encoder.encode(part));
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "text/html", "Content-Length": "47" },
      });
    })) as Response;
    const html = await response.text();
    expect(html).toMatch(
      /<h1>Products<\/h1><script>document\.currentScript\.remove\(\);\(function\(o\)\{.*<\/script><\/body><\/html>$/s,
    );
    expect(html).toContain(`"token":"${profiles[0]!.token}"`);
    expect(response.headers.has("Content-Length")).toBe(false);
  });

  it("leaves JSON and data requests alone, and the bar out when asked", async () => {
    const json = async () =>
      new Response("{}", { headers: { "Content-Type": "application/json" } });
    expect(
      await ((await middleware()(call("http://localhost/api"), json)) as Response).text(),
    ).toBe("{}");
    const page = async () =>
      new Response("<body></body>", { headers: { "Content-Type": "text/html" } });
    const off = profilerMiddleware({ toolbar: false });
    expect(await ((await off(call("http://localhost/"), page)) as Response).text()).toBe(
      "<body></body>",
    );
  });

  it("hangs a call under the page that made it", async () => {
    const ok = async () => new Response(null);
    await middleware()(
      call("http://localhost/api/promotions", { headers: { "X-Debug-Parent": "a1b2c3" } }),
      ok,
    );
    await middleware()(
      call("http://localhost/x", { headers: { "X-Debug-Parent": "<script>" } }),
      ok,
    );
    expect(profiles.map((profile) => profile.parentToken)).toEqual(["a1b2c3", undefined]);
  });

  it("does not profile its own routes", async () => {
    await middleware()(
      call("http://localhost/_profiler/api/profiles"),
      async () => new Response("[]"),
    );
    expect(profiles).toEqual([]);
  });

  it("does nothing outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const original = new Response("ok");
    const response = await profilerMiddleware()(call("http://localhost/"), async () => original);
    expect(response).toBe(original);
    expect(original.headers.has(TOKEN_HEADER)).toBe(false);
  });
});
