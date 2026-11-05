/** A call the page made, with the token its profile got. */
export interface Call {
  token: string;
  path: string;
}

export interface Tracker {
  /** The page the next calls hang under. */
  page?: string;
  listeners: Set<(call: Call) => void>;
}

/**
 * Tags the page's own calls with the page's token, so the server hangs them under it, and
 * tells who listens the token each one comes back with. Installed once per window.
 */
// Also inlined in the page, to run before the app hydrates: it may use nothing from outside itself.
export function installTracker(base: string, page?: string): Tracker {
  const key = Symbol.for("query-profiler.tracker");
  const slot = window as unknown as { [key: symbol]: Tracker | undefined };
  const installed = slot[key];
  if (installed) return installed;
  const tracker: Tracker = { page, listeners: new Set() };
  slot[key] = tracker;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const parent = tracker.page;
    if (url.origin !== location.origin || url.pathname.startsWith(base) || !parent)
      return original(request);
    const headers = new Headers(request.headers);
    headers.set("X-Debug-Parent", parent);
    const response = await original(new Request(request, { headers }));
    const token = response.headers.get("X-Debug-Token");
    if (token) {
      // `/orders.data` loads the page `/orders`; `/_.data` (React Router 8) and `/_root.data` load `/`.
      const path = url.pathname.replace(/\.data$/, "").replace(/^\/(_root|_)$/, "/");
      for (const listener of tracker.listeners) listener({ token, path });
    }
    return response;
  };
  return tracker;
}
