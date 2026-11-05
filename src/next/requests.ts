import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_BASE,
  endProfile,
  enterProfile,
  PARENT_HEADER,
  startProfile,
  TOKEN_HEADER,
  type Profile,
  type ProfileKind,
} from "../core/index.js";

const SKIPPED = [/^\/_next\//, /^\/__nextjs/, /^\/favicon\.ico$/, /^\/\.well-known\//];

interface RequestStart {
  request: IncomingMessage;
  response: ServerResponse;
}

const CHANNEL = "http.server.request.start";

export interface RequestOptions {
  /** Where the profiler's page and API live; requests to them are not profiled. */
  base?: string;
  /** Called with each profile once its response has been sent. */
  onProfile?: (profile: Profile) => void;
}

/**
 * Profiles every request the Node HTTP server in this process receives, from Node's diagnostics
 * channel. Returns how to stop.
 */
export function profileRequests(options: RequestOptions = {}): () => void {
  const base = options.base ?? DEFAULT_BASE;
  // Node publishes on this channel right before the server hands the request to its handler, so
  // the context entered here is the one the handler, and Next's render, runs in.
  const onRequest = (message: unknown) => {
    const { request, response } = message as RequestStart;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith(base) || SKIPPED.some((path) => path.test(url.pathname))) return;
    const active = startProfile(
      {
        method: request.method ?? "GET",
        url: shownUrl(url),
        kind: kindOf(request),
        parentToken: parentOf(request),
      },
      { name: "next" },
    );
    enterProfile(active);
    response.setHeader(TOKEN_HEADER, active.profile.token);
    response.once("close", () => {
      const profile = endProfile(active, { status: response.statusCode });
      options.onProfile?.(profile);
    });
  };
  subscribe(CHANNEL, onRequest);
  return () => unsubscribe(CHANNEL, onRequest);
}

function kindOf(request: IncomingMessage): ProfileKind {
  if (request.headers["next-action"]) return "action";
  if (request.headers.rsc) return "data";
  if (request.method !== "GET" && request.method !== "HEAD") return "action";
  return (request.headers.accept ?? "").includes("text/html") ? "document" : "api";
}

function parentOf(request: IncomingMessage): string | undefined {
  const token = request.headers[PARENT_HEADER.toLowerCase()];
  return typeof token === "string" && /^[0-9a-f]{6}$/.test(token) ? token : undefined;
}

// A client navigation loads `/products?_rsc=…`: it shows as the page it loads.
function shownUrl(url: URL): string {
  url.searchParams.delete("_rsc");
  return url.search ? `${url.pathname}${url.search}` : url.pathname;
}
