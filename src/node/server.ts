import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, DEFAULT_BASE } from "../core/index.js";
import { sendFetchResponse, toFetchRequest } from "../core/node-http.js";

const DEFAULT_PORT = 4983;
const WAITS = 10;
const WAIT_MS = 100;
const NEXT_PORTS = 10;

export interface ProfilerServerOptions {
  /** The port to try first: QUERY_PROFILER_PORT, else 4983. 0 takes any free one. */
  port?: number;
  /**
   * Where to listen: QUERY_PROFILER_HOST, else localhost. `0.0.0.0` lets a browser outside a
   * container reach it; it still answers only requests addressed to a local host.
   */
  host?: string;
  /** Called with the profiler's address once it listens. */
  onListening?: (url: string) => void;
}

/** Serves the profiler's page and API on a port of their own, next to the app's. */
export function profilerServer(options: ProfilerServerOptions = {}): Server {
  const first = options.port ?? portFromEnvironment();
  const host = options.host ?? (process.env.QUERY_PROFILER_HOST || "localhost");
  const handle = createHandler();
  const server = createServer((request, response) => {
    handle(toFetchRequest(request)).then(
      (answer) => sendFetchResponse(response, answer),
      () => response.writeHead(500).end(),
    );
  });
  let port = first;
  let waits = 0;
  const listen = () => server.listen(port, host);
  server.on("error", (error: NodeJS.ErrnoException) => {
    const busy = error.code === "EADDRINUSE" && port !== 0 && port < first + NEXT_PORTS;
    if (!busy) {
      console.warn(
        `[query-profiler] The profiler could not listen on port ${port} (${error.message}). Set QUERY_PROFILER_PORT to a free port.`,
      );
      return;
    }
    // A watcher (node --watch, tsx watch) starts the new app while the old one still holds the
    // port: wait a moment for it, then move on to the next port.
    if (port === first && waits++ < WAITS) setTimeout(listen, WAIT_MS);
    else {
      port += 1;
      listen();
    }
  });
  server.on("listening", () =>
    options.onListening?.(
      `http://localhost:${(server.address() as AddressInfo).port}${DEFAULT_BASE}`,
    ),
  );
  // The app's own server keeps the process alive; this one never should.
  server.unref();
  listen();
  return server;
}

function portFromEnvironment(): number {
  const port = Number(process.env.QUERY_PROFILER_PORT);
  return process.env.QUERY_PROFILER_PORT && Number.isInteger(port) ? port : DEFAULT_PORT;
}
