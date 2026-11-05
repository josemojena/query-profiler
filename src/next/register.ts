import { subscribe } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_BASE,
  enabled,
  endProfile,
  enterProfile,
  formatProfile,
  PARENT_HEADER,
  startProfile,
  TOKEN_HEADER,
  type ProfileKind,
} from "../core/index.js";

const SKIPPED = [/^\/_next\//, /^\/__nextjs/, /^\/favicon\.ico$/];

interface RequestStart {
  request: IncomingMessage;
  response: ServerResponse;
}

// Node announces every request on this channel right before the server hands it to Next, so the
// context entered here is the one Next renders in.
if (enabled())
  subscribe("http.server.request.start", (message) => {
    const { request, response } = message as RequestStart;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith(DEFAULT_BASE) || SKIPPED.some((path) => path.test(url.pathname)))
      return;
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
    response.once("close", () =>
      console.log(formatProfile(endProfile(active, { status: response.statusCode }))),
    );
  });

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
