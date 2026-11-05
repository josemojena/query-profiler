import { request } from "node:http";
import type { Profile } from "../core/index.js";

export interface Shared {
  /** Hands a finished profile to the profiler this process shares. */
  send: (profile: Profile) => void;
}

/**
 * Shares the profiler another process serves at `url`: each profile goes there. `onLost` is called
 * once, when that process goes away, for this one to take the port over.
 */
export function shareProfiler(url: string, onLost: () => void): Shared {
  let lost = false;
  const lose = () => {
    if (lost) return;
    lost = true;
    watch.destroy();
    onLost();
  };
  // The profiler's live stream stays open as long as it runs: its end is the sign to take over.
  const watch = request(
    `${url}/api/stream`,
    { headers: { Accept: "text/event-stream" } },
    (stream) => {
      stream.resume();
      stream.once("close", lose);
    },
  );
  watch.once("error", lose);
  watch.once("socket", (socket) => socket.unref());
  watch.end();
  return {
    send: (profile) => {
      if (lost) return;
      fetch(`${url}/api/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      }).then((response) => void response.body?.cancel(), lose);
    },
  };
}
