import type { Profile, ProfileListItem } from "query-profiler";
import { link } from "../data/site";
import demo from "./profiles.json";

const profiles = demo.profiles as Profile[];
// Each N+1's fix, as the example's profiler gave it: it reads the example's schema.prisma.
const fixes = demo.fixes;

/** Where the demo's profiler lives: no server behind it, the browser answers with sample profiles. */
export const DEMO_BASE = link("demo-profiler");

/** The page the bar opens on: the one with the N+1. */
export const DEMO_PAGE = profiles.find((profile) => profile.warnings.length)?.token ?? "";

const listItem = ({
  operations: _o,
  queries: _q,
  warnings,
  ...rest
}: Profile): ProfileListItem => ({
  ...rest,
  warningCount: warnings.length,
});

function answer(path: string, params: URLSearchParams, stats: unknown): Response {
  if (path === "/meta") return Response.json({ root: demo.root });
  if (path === "/stats") return Response.json(stats ?? {});
  if (path === "/stats/analysis")
    return Response.json(
      {
        error: "no_database",
        message: "this demo has no database behind it. In your app, it asks yours.",
      },
      { status: 409 },
    );
  if (path === "/profiles") {
    const parent = params.get("parent");
    const limit = Number(params.get("limit")) || 50;
    const listed = profiles.filter((profile) => !parent || profile.parentToken === parent);
    return Response.json(listed.slice(0, limit).map(listItem));
  }
  const fixed = /^\/profiles\/([0-9a-f]{6})\/fixes$/.exec(path)?.[1];
  if (fixed) return Response.json((fixes as Record<string, unknown>)[fixed] ?? {});
  const token = /^\/profiles\/([0-9a-f]{6})$/.exec(path)?.[1];
  const profile = profiles.find((candidate) => candidate.token === token);
  return profile ? Response.json(profile) : new Response("Not found", { status: 404 });
}

// The UI keeps a live stream open; the demo has nothing new to send.
class QuietEventSource extends EventTarget {
  readonly readyState = 1;
  close() {}
}

/** Answers the profiler UI's requests in the browser, so the real bar and page run on a static site. */
export function installDemoApi(stats?: unknown) {
  const api = `${DEMO_BASE}/api`;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!url.pathname.startsWith(api)) return original(input, init);
    return answer(url.pathname.slice(api.length), url.searchParams, stats);
  };
  window.EventSource = QuietEventSource as unknown as typeof EventSource;
}
