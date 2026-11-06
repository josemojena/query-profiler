import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, DEFAULT_BASE } from "../core/index.js";
import { sendFetchResponse, toFetchRequest } from "../core/node-http.js";

const DEFAULT_PORT = 4983;
const WAITS = 10;
const WAIT_MS = 100;
const NEXT_PORTS = 10;
const PROBE_MS = 300;

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
  /**
   * Called instead when another process's profiler holds the port (a cluster worker, a second app):
   * this one shares it rather than opening another.
   */
  onJoin?: (url: string) => void;
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
  const notProfilers = new Set<number>();
  // Exclusive, so cluster workers do not share one port through the primary, each with half.
  const listen = () => server.listen({ port, host, exclusive: true });
  const elsewhere = () => {
    // A watcher (node --watch, tsx watch) starts the new app while the old one still holds the
    // port: wait a moment for it, then move on to the next port.
    if (port === first && waits++ < WAITS) setTimeout(listen, WAIT_MS);
    else {
      port += 1;
      listen();
    }
  };
  server.on("error", (error: NodeJS.ErrnoException) => {
    const busy = error.code === "EADDRINUSE" && port !== 0 && port < first + NEXT_PORTS;
    if (!busy) {
      console.warn(
        `[query-profiler] The profiler could not listen on port ${port} (${error.message}). Set QUERY_PROFILER_PORT to a free port.`,
      );
      return;
    }
    if (!options.onJoin || notProfilers.has(port)) return elsewhere();
    const url = `http://localhost:${port}${DEFAULT_BASE}`;
    void servesProfiler(url).then((profiler) => {
      if (profiler) return options.onJoin?.(url);
      notProfilers.add(port);
      elsewhere();
    });
  });
  server.on("listening", () =>
    options.onListening?.(
      `http://localhost:${(server.address() as AddressInfo).port}${DEFAULT_BASE}`,
    ),
  );
  // The app's own server keeps the process alive; this one never should, nor its connections: a
  // page left open, or another process sharing it.
  server.unref();
  server.on("connection", (socket) => socket.unref());
  listen();
  return server;
}

/**
 * The profiler another process serves, for one that opens no port of its own (a script): where a
 * server would have opened it, or joined it.
 */
export async function findProfiler(): Promise<string | undefined> {
  const first = portFromEnvironment();
  for (let port = first; port && port < first + NEXT_PORTS; port += 1) {
    const url = `http://localhost:${port}${DEFAULT_BASE}`;
    const found = await probe(url);
    if (found === "profiler") return url;
    if (found === "nothing") return undefined;
  }
  return undefined;
}

/** Whether a query-profiler answers at `url`, to share it instead of taking another port. */
const servesProfiler = async (url: string) => (await probe(url)) === "profiler";

async function probe(url: string): Promise<"profiler" | "other" | "nothing"> {
  try {
    const response = await fetch(`${url}/api/meta`, { signal: AbortSignal.timeout(PROBE_MS) });
    const meta: unknown = await response.json().catch(() => undefined);
    return typeof meta === "object" && meta !== null && "root" in meta ? "profiler" : "other";
  } catch (error) {
    return (error as Error).name === "TimeoutError" ? "other" : "nothing";
  }
}

function portFromEnvironment(): number {
  const port = Number(process.env.QUERY_PROFILER_PORT);
  return process.env.QUERY_PROFILER_PORT && Number.isInteger(port) ? port : DEFAULT_PORT;
}
