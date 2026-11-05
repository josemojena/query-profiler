import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createHandler,
  DEFAULT_BASE,
  enabled,
  endProfile,
  PARENT_HEADER,
  runWithProfile,
  startProfile,
  TOKEN_HEADER,
  type Profile,
} from "../core/index.js";
import { sendFetchResponse, toFetchRequest } from "../core/node-http.js";

const EXPOSE_HEADERS = "Access-Control-Expose-Headers";

/** What Express hands a middleware, typed with Node's own classes so no Express types are needed. */
type Req = IncomingMessage & { originalUrl?: string; baseUrl?: string; route?: { path?: unknown } };
type Next = (error?: unknown) => void;

export interface ProfilerMiddlewareOptions {
  /** Where the profiler's page and API live; requests to them are not profiled. */
  base?: string;
  /** Called with each profile once its response has been sent. */
  onProfile?: (profile: Profile) => void;
}

/**
 * Opens a profile for each request and serves the profiler under `base`. Add it first, with
 * `app.use(profilerMiddleware())`; it does nothing outside development.
 */
export function profilerMiddleware(options: ProfilerMiddlewareOptions = {}) {
  if (!enabled()) return (_req: Req, _res: ServerResponse, next: Next) => next();
  const base = options.base ?? DEFAULT_BASE;
  const handle = createHandler({ base });
  return (req: Req, res: ServerResponse, next: Next) => {
    const url = req.originalUrl ?? req.url ?? "/";
    if (url.startsWith(base)) {
      handle(toFetchRequest(req)).then((response) => sendFetchResponse(res, response), next);
      return;
    }
    const active = startProfile(
      {
        method: req.method ?? "GET",
        url,
        kind: (req.headers.accept ?? "").includes("text/html") ? "document" : "api",
        parentToken: parentOf(req),
      },
      { name: "express" },
    );
    res.setHeader(TOKEN_HEADER, active.profile.token);
    if (req.headers.origin) exposeToken(res);
    res.once("close", () => {
      if (req.route) active.profile.request.route = routeOf(req);
      const profile = endProfile(active, { status: res.statusCode });
      options.onProfile?.(profile);
    });
    runWithProfile(active, next);
  };
}

function parentOf(req: IncomingMessage): string | undefined {
  const token = req.headers[PARENT_HEADER.toLowerCase()];
  return typeof token === "string" && /^[0-9a-f]{6}$/.test(token) ? token : undefined;
}

// Express names the route that answered once it has, on a router mounted at baseUrl.
const routeOf = (req: Req) => `${req.baseUrl ?? ""}${String(req.route?.path ?? "")}`;

// A page on another origin can only read the token if CORS exposes it.
function exposeToken(res: ServerResponse) {
  const current = res.getHeader(EXPOSE_HEADERS);
  const exposed = [current].flat().filter(Boolean).join(", ");
  if (!exposed.toLowerCase().includes(TOKEN_HEADER.toLowerCase()))
    res.setHeader(EXPOSE_HEADERS, exposed ? `${exposed}, ${TOKEN_HEADER}` : TOKEN_HEADER);
}
