import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import type { ServerHttp2Stream } from "node:http2";
import {
  endProfile,
  enterProfile,
  PARENT_HEADER,
  startProfile,
  TOKEN_HEADER,
  type Profile,
} from "../core/index.js";

const CHANNEL = "http.server.request.start";
// Published by Node 22.17+ and 24.2+; earlier versions never do, and HTTP/2 goes unprofiled.
const HTTP2_CHANNEL = "http2.server.stream.start";
const SKIPPED = [/^\/favicon\.ico$/, /^\/\.well-known\//];
const EXPOSE_HEADERS = "Access-Control-Expose-Headers";

interface RequestStart {
  request: IncomingMessage;
  response: ServerResponse;
  server: Server;
}

interface StreamStart {
  stream: ServerHttp2Stream;
  headers: IncomingHttpHeaders;
}

export interface RequestOptions {
  /** Servers whose requests are not profiled: the profiler's own. */
  skip?: (server: Server) => boolean;
  /** Called with each profile once its response has been sent. */
  onProfile?: (profile: Profile) => void;
}

/**
 * Profiles every request the Node HTTP servers in this process receive, whatever framework
 * answers them, from Node's diagnostics channel. Returns how to stop.
 */
export function profileRequests(options: RequestOptions = {}): () => void {
  const open = (method: string, path: string, headers: IncomingHttpHeaders) => {
    const url = new URL(path, "http://localhost");
    if (SKIPPED.some((skipped) => skipped.test(url.pathname))) return undefined;
    const active = startProfile(
      {
        method,
        url: `${url.pathname}${url.search}`,
        kind: (headers.accept ?? "").includes("text/html") ? "document" : "api",
        parentToken: parentOf(headers),
      },
      { name: "node" },
    );
    enterProfile(active);
    return active;
  };
  // Node publishes on these channels right before the server hands the request to its handler,
  // so the context entered here is the one the framework, and every query it makes, runs in.
  const onRequest = (message: unknown) => {
    const { request, response, server } = message as RequestStart;
    if (options.skip?.(server)) return;
    const active = open(request.method ?? "GET", request.url ?? "/", request.headers);
    if (!active) return;
    response.setHeader(TOKEN_HEADER, active.profile.token);
    // A page on another origin can only read the token if CORS exposes it; the app's own CORS
    // settings, set later, win.
    if (request.headers.origin) response.setHeader(EXPOSE_HEADERS, TOKEN_HEADER);
    response.once("close", () => {
      const profile = endProfile(active, { status: response.statusCode });
      options.onProfile?.(profile);
    });
  };
  // An HTTP/2 stream has no response to set a header on before the app answers: no token there.
  const onStream = (message: unknown) => {
    const { stream, headers } = message as StreamStart;
    const active = open(
      String(headers[":method"] ?? "GET"),
      String(headers[":path"] ?? "/"),
      headers,
    );
    stream.once("close", () => {
      if (!active) return;
      const profile = endProfile(active, { status: Number(stream.sentHeaders[":status"] ?? 0) });
      options.onProfile?.(profile);
    });
  };
  subscribe(CHANNEL, onRequest);
  subscribe(HTTP2_CHANNEL, onStream);
  return () => {
    unsubscribe(CHANNEL, onRequest);
    unsubscribe(HTTP2_CHANNEL, onStream);
  };
}

function parentOf(headers: IncomingHttpHeaders): string | undefined {
  const token = headers[PARENT_HEADER.toLowerCase()];
  return typeof token === "string" && /^[0-9a-f]{6}$/.test(token) ? token : undefined;
}
