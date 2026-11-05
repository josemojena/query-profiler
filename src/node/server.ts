import { createServer, type Server } from "node:http";
import { createHandler, DEFAULT_BASE } from "../core/index.js";
import { sendFetchResponse, toFetchRequest } from "../core/node-http.js";

const DEFAULT_PORT = 4983;
const RETRIES = 20;

/** The profiler's page and API on a port of their own; QUERY_PROFILER_PORT picks it. */
export function profilerServer(onReady: (url: string) => void): Server {
  const port = Number(process.env.QUERY_PROFILER_PORT) || DEFAULT_PORT;
  const handle = createHandler();
  const server = createServer((req, res) => {
    handle(toFetchRequest(req)).then(
      (response) => sendFetchResponse(res, response),
      () => res.writeHead(500).end(),
    );
  });
  // A watcher (tsx watch, node --watch) restarts the app before the old one has let go of the port.
  let attempts = 0;
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE" || ++attempts > RETRIES) throw error;
    setTimeout(() => server.listen(port, "localhost"), 100);
  });
  server.listen(port, "localhost", () => onReady(`http://localhost:${port}${DEFAULT_BASE}`));
  // The app's own server keeps the process alive; this one never should.
  server.unref();
  return server;
}
