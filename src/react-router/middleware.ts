import {
  currentScope,
  DEFAULT_BASE,
  enabled,
  PARENT_HEADER,
  TOKEN_HEADER,
  endProfile,
  runWithProfile,
  startProfile,
  type ActiveProfile,
  type Profile,
} from "../core/index.js";
import type { MiddlewareFunction } from "react-router";
import { injectBeforeBodyEnd, toolbarSnippet } from "./inject.js";
import { isDataAnswer, kindOf, parentToken, shownUrl } from "./requests.js";

export { TOKEN_HEADER };

export interface ProfilerMiddlewareOptions {
  /** Where the profiler's own routes live; requests to them are not profiled. */
  base?: string;
  /** Add the bar to HTML pages. Needs `queryProfiler()` in the Vite config, which serves it. */
  toolbar?: boolean;
  /** Called with each profile once its response has been sent. */
  onProfile?: (profile: Profile) => void;
}

/** Opens a profile for each request; a no-op outside development. */
export function profilerMiddleware(
  options: ProfilerMiddlewareOptions = {},
): MiddlewareFunction<Response> {
  if (!enabled()) return (_args, next) => next();
  const base = options.base ?? DEFAULT_BASE;
  return async ({ request }, next) => {
    const url = new URL(request.url);
    // The Vite plugin already profiles every request in development.
    if (url.pathname.startsWith(base) || currentScope()) return next();
    const active = startProfile(
      {
        method: request.method,
        url: shownUrl(url),
        kind: kindOf(request.method, url),
        parentToken: parentOf(request),
      },
      { name: "react-router" },
    );
    const end = (status: number) => {
      if (active.closed) return;
      const profile = endProfile(active, { status });
      options.onProfile?.(profile);
    };
    try {
      const response = withToken(await runWithProfile(active, () => next()), active);
      if (active.profile.kind === "document" && isDataResponse(response))
        active.profile.kind = "data";
      const page =
        options.toolbar !== false && active.profile.kind === "document" && isHtml(response)
          ? withToolbar(response, toolbarSnippet(base, active.profile.token))
          : response;
      return endWhenSent(page, () => end(response.status));
    } catch (error) {
      end(error instanceof Response ? error.status : 500);
      throw error;
    }
  };
}

const parentOf = (request: Request) => parentToken(request.headers.get(PARENT_HEADER));

const isDataResponse = (response: Response) =>
  isDataAnswer(
    response.headers.get("Content-Type") ?? "",
    response.headers.has("X-Remix-Response"),
  );

const isHtml = (response: Response) =>
  !!response.body && (response.headers.get("Content-Type") ?? "").includes("text/html");

function withToolbar(response: Response, snippet: string): Response {
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(injectBeforeBodyEnd(response.body!, snippet), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withToken(response: Response, active: ActiveProfile): Response {
  const copy = new Response(response.body, response);
  copy.headers.set(TOKEN_HEADER, active.profile.token);
  return copy;
}

// A streamed document keeps loading (deferred data) after next() resolves.
function endWhenSent(response: Response, end: () => void): Response {
  if (!response.body) {
    end();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (!done) return controller.enqueue(value);
      end();
      controller.close();
    },
    cancel(reason) {
      end();
      return reader.cancel(reason);
    },
  });
  return new Response(body, response);
}
