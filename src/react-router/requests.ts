import type { ProfileKind } from "../core/index.js";

/** The page token a call was tagged with, if it is one. */
export const parentToken = (value: string | null | undefined) =>
  value && /^[0-9a-f]{6}$/.test(value) ? value : undefined;

/** A data request (`/orders.data?_routes=…`, or `/_.data` for `/`) shows as the route it loads. */
export function shownUrl(url: URL): string {
  const search = new URLSearchParams(url.search);
  search.delete("_routes");
  const path = url.pathname.replace(/\.data$/, "").replace(/^\/(_root|_)$/, "/");
  return search.size ? `${path}?${search}` : path;
}

export function kindOf(method: string, url: URL): ProfileKind {
  if (method !== "GET" && method !== "HEAD") return "action";
  return url.pathname.endsWith(".data") ? "data" : "document";
}

/** React Router strips `.data` from a data request before middleware sees it; its answer still tells. */
export const isDataAnswer = (contentType: string, remixHeader: boolean) =>
  remixHeader || contentType.startsWith("text/x-script");
