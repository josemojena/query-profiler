import { analyzeQuery, readFindings, tryIndex, type Finding } from "../analysis/analyze.js";
import { analyzeSession } from "../analysis/session.js";
import { ANALYSIS_HEADER } from "./constants.js";
import { findDatabase } from "./database.js";
import type { QueryRecord } from "./profile.js";
import { getProfile, listProfiles } from "./storage.js";

const ROUTE = /^\/api\/profiles\/([0-9a-f]+)\/(?:findings|queries\/(q_\d+)\/(analysis|trial))$/;
const MEMORY = 1000;
const remembered = new Map<string, Finding[]>();

/** The analysis routes, or undefined when the path is none of them. */
export function analysisRoute(request: Request, path: string): Promise<Response> | undefined {
  if (path === "/api/stats/analysis") return sessionRoute(request);
  const match = ROUTE.exec(path);
  if (!match) return undefined;
  const [, token, queryId, action] = match;
  return answer(request, token!, queryId, action);
}

async function answer(
  request: Request,
  token: string,
  queryId: string | undefined,
  action: string | undefined,
): Promise<Response> {
  const method = request.method === "HEAD" ? "GET" : request.method;
  const profile = getProfile(token);
  if (!profile) return json({ error: "not_found" }, 404);
  if (!action) {
    if (method !== "GET") return json({ error: "not_found" }, 404);
    return json(Object.fromEntries(profile.queries.map((query) => [query.id, findingsOf(query)])));
  }
  if (method !== (action === "trial" ? "POST" : "GET")) return json({ error: "not_found" }, 404);
  if (!request.headers.has(ANALYSIS_HEADER)) return json({ error: "forbidden" }, 403);
  const query = profile.queries.find((each) => each.id === queryId);
  if (!query) return json({ error: "not_found" }, 404);
  const database = findDatabase(query.database);
  if (!database)
    return json(
      {
        error: "no_database",
        message:
          "The connection that ran this query is gone, or its database is not one the profiler can ask.",
      },
      409,
    );
  try {
    if (action === "analysis") {
      const measure = new URL(request.url).searchParams.get("measure") === "1";
      return json(await analyzeQuery(database, query, { measure }));
    }
    const body = (await request.json().catch(() => ({}))) as { index?: unknown };
    const analysis = await analyzeQuery(database, query);
    const fix = analysis.findings.find(
      (finding) => finding.fix?.index !== undefined && finding.fix.index === body.index,
    )?.fix;
    if (!fix?.index || !fix.sql) return json({ error: "no_such_index" }, 404);
    return json(await tryIndex(database, query, { name: fix.index, sql: fix.sql }));
  } catch (error) {
    return json(
      { error: "database_error", message: error instanceof Error ? error.message : String(error) },
      422,
    );
  }
}

/** Every statement shape of the stored requests, analyzed once: it asks the database. */
async function sessionRoute(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "not_found" }, 404);
  if (!request.headers.has(ANALYSIS_HEADER)) return json({ error: "forbidden" }, 403);
  return json(await analyzeSession(listProfiles(), (query) => findDatabase(query.database)));
}

// The same SQL with the same values and rows always gives the same findings.
function findingsOf(query: QueryRecord): Finding[] {
  if (!query.database) return [];
  const key = `${query.database.provider}\u0000${query.sql}\u0000${JSON.stringify(query.params)}\u0000${query.rows}`;
  const known = remembered.get(key);
  if (known) return known;
  const findings = readFindings(query, query.database.provider);
  if (remembered.size >= MEMORY) remembered.delete(remembered.keys().next().value!);
  remembered.set(key, findings);
  return findings;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
