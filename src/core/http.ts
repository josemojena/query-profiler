import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { analysisRoute } from "./analysis-http.js";
import { uiAsset } from "./assets.js";
import { DEFAULT_BASE } from "./constants.js";
import { enabled } from "./enabled.js";
import type { Profile, ProfileListItem } from "./profile.js";
import { stats } from "./stats.js";
import {
  clearProfiles,
  getProfile,
  listProfiles,
  onClear,
  onProfile,
  storeProfile,
} from "./storage.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
// A profile holds at most MAX_QUERIES queries: far below this.
const MAX_BODY = 20 * 1024 * 1024;

export interface HandlerOptions {
  base?: string;
  /** Hosts allowed to read profiles. Only local ones by default, even if the dev server listens on more. */
  allowedHosts?: string[];
}

/** The profiler's HTTP API, as a Fetch handler any framework can mount. */
export function createHandler(
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const base = options.base ?? DEFAULT_BASE;
  const hosts = options.allowedHosts ?? LOCAL_HOSTS;
  return async (request) => {
    const url = new URL(request.url);
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (!enabled() || !hosts.includes(url.hostname) || !url.pathname.startsWith(base))
      return new Response("Not found", { status: 404 });
    const path = url.pathname.slice(base.length);
    const token = /^\/api\/profiles\/([0-9a-f]+)$/.exec(path)?.[1];
    if (method === "GET" && isPage(path)) return page(base);
    const asset = method === "GET" ? uiAsset(base, path) : undefined;
    if (asset) return asset;
    if (method === "GET" && path === "/api/meta") return json({ root: projectRoot() });
    if (method === "GET" && path === "/api/stats") return json(stats(listProfiles()));
    if (method === "GET" && path === "/api/profiles") return json(list(url.searchParams));
    if (method === "GET" && token) {
      const profile = getProfile(token);
      return profile ? json(profile) : json({ error: "not_found" }, 404);
    }
    if (method === "GET" && path === "/api/stream") return stream();
    const analysis = analysisRoute(request, path);
    if (analysis) return analysis;
    if (method === "POST" && path === "/api/profiles") return receive(request);
    if (method === "DELETE" && path === "/api/profiles") {
      clearProfiles();
      return new Response(null, { status: 204 });
    }
    return json({ error: "not_found" }, 404);
  };
}

/**
 * Another process's profile, for the profiler that serves the port to show: finished, or a script's
 * as it runs, sent again as it grows. JSON only and no Origin: a page in a browser cannot send that
 * across origins without a preflight, which this never answers.
 */
async function receive(request: Request): Promise<Response> {
  if (request.headers.has("origin")) return json({ error: "forbidden" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "unsupported_media_type" }, 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    return json({ error: "too_large" }, 413);
  const profile: unknown = await request.json().catch(() => undefined);
  if (!isProfile(profile)) return json({ error: "bad_request" }, 400);
  // The later one wins: a repeat, or a snapshot that arrives after the end, does not.
  const stored = getProfile(profile.token);
  if (!stored || (profile.durationMs ?? 0) > (stored.durationMs ?? 0)) storeProfile(profile);
  return new Response(null, { status: 204 });
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Partial<Profile>;
  return (
    profile.schemaVersion === 1 &&
    typeof profile.token === "string" &&
    /^[0-9a-f]{6}$/.test(profile.token) &&
    typeof profile.request?.url === "string" &&
    Array.isArray(profile.queries) &&
    Array.isArray(profile.operations) &&
    Array.isArray(profile.warnings) &&
    typeof profile.summary === "object"
  );
}

const isPage = (path: string) => /^(\/?|\/stats|\/[0-9a-f]{6})$/.test(path);

/** The profiler's own page: the UI's code does the rest. */
function page(base: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Query Profiler</title></head><body style="margin:0"><query-profiler-page data-base="${base}"></query-profiler-page><script type="module" src="${base}/ui.js"></script></body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function toListItem(profile: Profile): ProfileListItem {
  const { operations: _operations, queries: _queries, warnings, ...rest } = profile;
  return { ...rest, warningCount: warnings.length };
}

function list(params: URLSearchParams): ProfileListItem[] {
  const url = params.get("url");
  const kind = params.get("kind");
  const parent = params.get("parent");
  const limit = Number(params.get("limit")) || 50;
  return listProfiles()
    .filter(
      (profile) =>
        (!url || profile.request.url === url) &&
        (!kind || profile.kind === kind) &&
        (!parent || profile.parentToken === parent),
    )
    .slice(0, limit)
    .map(toListItem);
}

function stream(): Response {
  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const unsubscribe = onProfile((profile) =>
        send(`event: profile\ndata: ${JSON.stringify(toListItem(profile))}\n\n`),
      );
      // A browser drops an event that carries no data.
      const unsubscribeClear = onClear(() => send("event: clear\ndata: {}\n\n"));
      // An open profiler page never keeps the app's process alive by itself.
      const heartbeat = setInterval(() => send(": ping\n\n"), 15_000);
      heartbeat.unref?.();
      stop = () => {
        unsubscribe();
        unsubscribeClear();
        clearInterval(heartbeat);
      };
      send(": connected\n\n");
    },
    cancel: () => stop(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Where paths are shown from: the repository root, or the working directory. */
function projectRoot(): string {
  for (let dir = process.cwd(); dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(join(dir, ".git"))) return dir;
  return process.cwd();
}
