import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { createHandler } from "../core/index.js";
import { DEFAULT_BASE } from "../core/constants.js";
import { sendFetchResponse, toFetchRequest } from "../core/node-http.js";
import { toolbarScript } from "../ui/snippet.js";
import { profileRequests } from "./requests.js";
import type { Plugin, ViteDevServer } from "vite";

const UI_MODULE = "virtual:query-profiler/ui";
const BAR_MODULE = "virtual:query-profiler/bar";
// React Router's client entry: the app's own, or its default one.
const CLIENT_ENTRY = /[\\/]entry\.client\.[jt]sx?$/;
const require = createRequire(import.meta.url);
const UI = require.resolve("query-profiler/ui");
const CORE = require.resolve("query-profiler");

export interface QueryProfilerOptions {
  /** Where the profiler's pages and API live. */
  base?: string;
  /** Print one line per request in the terminal. */
  log?: boolean;
}

/**
 * In development, serves the profiler's API and the bar's code under `base`. In every mode,
 * lets Vite process the profiler's entries, so the `development` entry is used in dev and
 * the no-op one is inlined in builds: production never needs them installed.
 */
export function queryProfiler(options: QueryProfilerOptions = {}): Plugin {
  const base = options.base ?? DEFAULT_BASE;
  let serving = false;
  return {
    name: "query-profiler",
    config: () => ({ ssr: { noExternal: [/^query-profiler(\/|$)/] } }),
    resolveId: (id) => (id === UI_MODULE || id === BAR_MODULE ? `\0${id}` : undefined),
    load(id) {
      if (id === `\0${UI_MODULE}`) return `import ${JSON.stringify(UI)};`;
      if (id === `\0${BAR_MODULE}`) return toolbarScript(base);
      return undefined;
    },
    // In development, the app's client entry brings the bar first, before the app hydrates.
    transform(code, id, options) {
      if (serving && !options?.ssr && CLIENT_ENTRY.test(id))
        return { code: `import ${JSON.stringify(BAR_MODULE)};${code}`, map: null };
      return undefined;
    },
    configResolved(config) {
      serving = config.command === "serve";
    },
    configureServer(server) {
      server.middlewares.use(base, (req, res, fail) => {
        serve(server, req, res).catch((error: unknown) => fail(error));
      });
      return () => server.middlewares.use(profileRequests(base, options.log ?? false));
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
  sendFetchResponse(res, await core.createHandler()(toFetchRequest(req)));
}
