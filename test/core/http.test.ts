import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandler } from "../../src/core/http.js";
import { beginQuery, endProfile, startProfile } from "../../src/core/recorder.js";
import { clearProfiles, listProfiles } from "../../src/core/storage.js";
import type { Profile, ProfileListItem } from "../../src/core/profile.js";

const handle = createHandler();
const get = (path: string, host = "localhost:3100") => handle(new Request(`http://${host}${path}`));

const send = (body: string, headers: Record<string, string> = {}) =>
  handle(
    new Request("http://localhost:4983/_profiler/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    }),
  );

function record(url: string, kind: "document" | "data" = "document") {
  const active = startProfile({ method: "GET", url, kind }, { name: "test" });
  beginQuery(active, { sql: "SELECT 1" });
  return endProfile(active, { status: 200 });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearProfiles();
});
afterEach(() => vi.unstubAllEnvs());

describe("the profiler API", () => {
  it("lists profiles newest first, without their records, and filters them", async () => {
    const home = record("/");
    const news = record("/news");
    record("/news.data", "data");
    const all = (await (await get("/_profiler/api/profiles")).json()) as ProfileListItem[];
    expect(all.map((item) => item.token).slice(1)).toEqual([news.token, home.token]);
    expect(all[0]).not.toHaveProperty("queries");
    expect(all[0]).toMatchObject({ warningCount: 0, summary: { queryCount: 1 } });
    const filtered = (await (
      await get("/_profiler/api/profiles?url=/news&kind=document")
    ).json()) as ProfileListItem[];
    expect(filtered.map((item) => item.token)).toEqual([news.token]);
  });

  it("lists the calls a page made", async () => {
    const page = record("/products");
    const promotions = endProfile(
      startProfile(
        { method: "GET", url: "/api/promotions", kind: "api", parentToken: page.token },
        { name: "test" },
      ),
    );
    record("/other");
    const children = (await (
      await get(`/_profiler/api/profiles?parent=${page.token}`)
    ).json()) as ProfileListItem[];
    expect(children.map((item) => [item.token, item.parentToken])).toEqual([
      [promotions.token, page.token],
    ]);
  });

  it("returns one profile whole, or 404", async () => {
    const profile = record("/");
    expect(
      (await (await get(`/_profiler/api/profiles/${profile.token}`)).json()) as Profile,
    ).toEqual(profile);
    expect((await get("/_profiler/api/profiles/ffffff")).status).toBe(404);
  });

  it("streams each profile as it ends", async () => {
    const response = await get("/_profiler/api/stream");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
    const profile = record("/news");
    const event = decoder.decode((await reader.read()).value);
    expect(event).toMatch(/^event: profile\ndata: /);
    expect(JSON.parse(event.split("data: ")[1]!)).toMatchObject({
      token: profile.token,
      request: { url: "/news" },
    });
    await reader.cancel();
  });

  it("empties the storage", async () => {
    record("/");
    const response = await handle(
      new Request("http://localhost/_profiler/api/profiles", { method: "DELETE" }),
    );
    expect(response.status).toBe(204);
    expect(await (await get("/_profiler/api/profiles")).json()).toEqual([]);
  });

  it("takes another process's finished profile, once, and streams it", async () => {
    const profile = record("/from-a-worker");
    clearProfiles();
    const reader = (await get("/_profiler/api/stream")).body!.getReader();
    await reader.read();
    const response = await send(JSON.stringify(profile));
    expect(response.status).toBe(204);
    expect(new TextDecoder().decode((await reader.read()).value)).toMatch(/^event: profile\n/);
    await send(JSON.stringify(profile));
    expect(listProfiles().map((stored) => stored.token)).toEqual([profile.token]);
    await reader.cancel();
  });

  it("takes no profile from a browser page, nor anything that is not one", async () => {
    const body = JSON.stringify(record("/"));
    clearProfiles();
    expect((await send(body, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await send(body, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send(JSON.stringify({ token: "zzz" }))).status).toBe(400);
    expect((await send("{not json")).status).toBe(400);
    expect(listProfiles()).toEqual([]);
  });

  it("tells every open stream when the storage is emptied", async () => {
    const reader = (await get("/_profiler/api/stream")).body!.getReader();
    const decoder = new TextDecoder();
    await reader.read();
    await handle(new Request("http://localhost/_profiler/api/profiles", { method: "DELETE" }));
    expect(decoder.decode((await reader.read()).value)).toBe("event: clear\ndata: {}\n\n");
    await reader.cancel();
  });

  it("answers only local hosts, and only in development", async () => {
    record("/");
    expect((await get("/_profiler/api/profiles", "abc.ngrok.app")).status).toBe(404);
    vi.stubEnv("NODE_ENV", "production");
    expect((await get("/_profiler/api/profiles")).status).toBe(404);
  });

  it("serves its own page for the list, a profile and the stats", async () => {
    for (const path of ["/_profiler", "/_profiler/", "/_profiler/a1b2c3", "/_profiler/stats"]) {
      const response = await get(path);
      expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
      const html = await response.text();
      expect(html).toContain('<query-profiler-page data-base="/_profiler">');
      expect(html).toContain('src="/_profiler/ui.js"');
    }
    expect((await get("/_profiler/nope")).status).toBe(404);
  });

  it("serves the bar and the page's code itself, for servers without Vite", async () => {
    const entry = await get("/_profiler/ui.js");
    expect(entry.status).toBe(302);
    expect(entry.headers.get("Location")).toBe("/_profiler/ui/index.js");
    const index = await get("/_profiler/ui/index.js");
    expect(index.headers.get("Content-Type")).toMatch(/^text\/javascript/);
    expect(await index.text()).toContain("query-profiler-toolbar");
    expect(await (await get("/_profiler/ui/element.js")).text()).toContain("ProfilerToolbar");
    expect((await get("/_profiler/ui/missing.js")).status).toBe(404);
    expect((await get("/_profiler/ui/index.d.ts")).status).toBe(404);
  });

  it("adds the stored profiles up", async () => {
    record("/");
    expect(await (await get("/_profiler/api/stats")).json()).toMatchObject({
      profiles: 1,
      slowest: [{ sql: "SELECT 1" }],
    });
  });

  it("tells where paths are relative to", async () => {
    const { root } = (await (await get("/_profiler/api/meta")).json()) as { root: string };
    expect(process.cwd().startsWith(root)).toBe(true);
  });
});
