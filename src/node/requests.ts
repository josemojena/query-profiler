import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  endProfile,
  enterProfile,
  PARENT_HEADER,
  startProfile,
  TOKEN_HEADER,
  type Profile,
} from "../core/index.js";

const CHANNEL = "http.server.request.start";
const SKIPPED = [/^\/favicon\.ico$/, /^\/\.well-known\//];

interface RequestStart {
  request: IncomingMessage;
  response: ServerResponse;
  server: Server;
}

export interface RequestOptions {
  /** A server whose requests are not profiled: the profiler's own. */
  skip?: Server;
  /** Called with each profile once its response has been sent. */
  onProfile?: (profile: Profile) => void;
}

/**
 * Profiles every request the Node HTTP servers in this process receive, whatever framework
 * answers them, from Node's diagnostics channel. Returns how to stop.
 */
export function profileRequests(options: RequestOptions = {}): () => void {
  // Node publishes on this channel right before the server hands the request to its handler, so
  // the context entered here is the one the framework, and every query it makes, runs in.
  const onRequest = (message: unknown) => {
    const { request, response, server } = message as RequestStart;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (server === options.skip || SKIPPED.some((path) => path.test(url.pathname))) return;
    const active = startProfile(
      {
        method: request.method ?? "GET",
        url: `${url.pathname}${url.search}`,
        kind: (request.headers.accept ?? "").includes("text/html") ? "document" : "api",
        parentToken: parentOf(request),
      },
      { name: "node" },
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

function parentOf(request: IncomingMessage): string | undefined {
  const token = request.headers[PARENT_HEADER.toLowerCase()];
  return typeof token === "string" && /^[0-9a-f]{6}$/.test(token) ? token : undefined;
}
