import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/** A Node request as a Fetch one, for `createHandler()`. */
export function toFetchRequest(req: IncomingMessage & { originalUrl?: string }): Request {
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

/** Writes a Fetch response to a Node one, streaming its body. */
export function sendFetchResponse(res: ServerResponse, response: Response): void {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return void res.end();
  if (res.req.method === "HEAD") {
    void response.body.cancel();
    return void res.end();
  }
  const body = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
  // A server-sent event stream never ends by itself: stop it when the browser goes away.
  res.on("close", () => body.destroy());
  body.pipe(res);
}
