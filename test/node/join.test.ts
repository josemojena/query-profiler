import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import type { Profile } from "../../src/core/index.js";
import { shareProfiler } from "../../src/node/join.js";

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** A profiler that keeps its live stream open, notes each profile it gets, and holds back the first answer. */
async function slowProfiler() {
  const received: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const server = createServer((request, response: ServerResponse) => {
    if (request.url?.endsWith("/api/stream")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" }).write(": connected\n\n");
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk));
    request.on("end", () => {
      received.push((JSON.parse(body) as Profile).token);
      const answer = () => response.writeHead(204).end();
      if (received.length === 1) void held.then(answer);
      else answer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(
    () => server.closeAllConnections(),
    () => server.close(),
  );
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/_profiler`;
  return { url, received, release };
}

it("sends a process's profiles one at a time, in the order they finished", async () => {
  const profiler = await slowProfiler();
  const shared = shareProfiler(profiler.url, () => {});
  shared.send({ token: "aaaaaa" } as Profile);
  shared.send({ token: "bbbbbb" } as Profile);
  await vi.waitFor(() => expect(profiler.received).toEqual(["aaaaaa"]));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(profiler.received).toEqual(["aaaaaa"]);
  profiler.release();
  await vi.waitFor(() => expect(profiler.received).toEqual(["aaaaaa", "bbbbbb"]));
});
