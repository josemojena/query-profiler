import type { IncomingMessage, ServerResponse } from "node:http";
import {
  endProfile,
  formatProfile,
  PARENT_HEADER,
  runWithProfile,
  startProfile,
  TIMING_NAME,
  TOKEN_HEADER,
} from "../core/index.js";
import { isDataAnswer, kindOf, parentToken, shownUrl } from "./react-router.js";

type Request = IncomingMessage & { originalUrl?: string };
type Next = (error?: unknown) => void;

const SKIPPED = [/^\/@/, /^\/__/, /^\/node_modules\//, /^\/favicon\.ico$/, /^\/\.well-known\//];

/**
 * Opens a profile for each request the app's server answers in the Vite dev server, and runs the
 * rest of the request inside it. Added after Vite's own middleware, so modules and assets never
 * reach it.
 */
export function profileRequests(base: string, log: boolean) {
  return (req: Request, res: ServerResponse, next: Next) => {
    const url = new URL(req.originalUrl ?? req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith(base) || SKIPPED.some((path) => path.test(url.pathname)))
      return next();
    const method = req.method ?? "GET";
    const header = req.headers[PARENT_HEADER.toLowerCase()];
    const active = startProfile(
      {
        method,
        url: shownUrl(url),
        kind: kindOf(method, url),
        parentToken: parentToken(typeof header === "string" ? header : undefined),
      },
      { name: "react-router" },
    );
    res.setHeader(TOKEN_HEADER, active.profile.token);
    res.setHeader("Server-Timing", `${TIMING_NAME};desc="${active.profile.token}"`);
    res.once("close", () => {
      const contentType = String(res.getHeader("Content-Type") ?? "");
      if (
        active.profile.kind === "document" &&
        isDataAnswer(contentType, res.hasHeader("X-Remix-Response"))
      )
        active.profile.kind = "data";
      const profile = endProfile(active, { status: res.statusCode });
      if (log) console.log(formatProfile(profile));
    });
    runWithProfile(active, next);
  };
}
