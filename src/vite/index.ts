import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { createHandler } from "../core/index.js";
import { DEFAULT_BASE } from "../core/constants.js";
import type { Plugin, ViteDevServer } from "vite";

const UI_MODULE = "virtual:query-profiler/ui";
const require = createRequire(import.meta.url);
const UI = require.resolve("query-profiler/ui");
const CORE = require.resolve("query-profiler");

export interface QueryProfilerOptions {
  /** Where the profiler's pages and API live. */
  base?: string;
}

/**
 * In development, serves the profiler's API and the bar's code under `base`. In every mode,
 * lets Vite process the profiler's entries, so the `development` entry is used in dev and
 * the no-op one is inlined in builds: production never needs them installed.
 */
export function queryProfiler(options: QueryProfilerOptions = {}): Plugin {
  const base = options.base ?? DEFAULT_BASE;
  return {
    name: "query-profiler",
    config: () => ({ ssr: { noExternal: [/^query-profiler(\/|$)/] } }),
    resolveId: (id) => (id === UI_MODULE ? `\0${UI_MODULE}` : undefined),
    load: (id) => (id === `\0${UI_MODULE}` ? `import ${JSON.stringify(UI)};` : undefined),
    configureServer(server) {
      server.middlewares.use(base, (req, res, fail) => {
        serve(server, req, res).catch((error: unknown) => fail(error));
      });
    },
  };
}

async function serve(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  if (req.url === "/ui.js") {
    res.writeHead(302, { Location: `/@id/__x00__${UI_MODULE}` }).end();
    return;
  }
  // Loaded through Vite so it is the same code, and the same profiles, the app's server uses.
  const core = (await server.ssrLoadModule(CORE)) as {
    createHandler: typeof createHandler;
  };
  await send(res, await core.createHandler()(toRequest(req)));
}

function toRequest(req: IncomingMessage & { originalUrl?: string }): Request {
  const url = new URL(
    req.originalUrl ?? req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  return new Request(url, {
    method,
    headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    duplex: "half",
  } as RequestInit);
}

async function send(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return void res.end();
  const body = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
  // A server-sent event stream never ends by itself: stop it when the browser goes away.
  res.on("close", () => body.destroy());
  body.pipe(res);
}
