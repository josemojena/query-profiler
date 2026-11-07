import {
  analyzeQuery,
  readFindings,
  tryIndex,
  type Analysis,
  type Finding,
  type Trial,
} from "../analysis/analyze.js";
import type { NoPlan } from "../analysis/explain.js";
import { n1Fixes } from "../analysis/n1.js";
import { findSchema, prismaNames, type Schema } from "../analysis/schema.js";
import { analyzeSession } from "../analysis/session.js";
import { ANALYSIS_HEADER } from "./constants.js";
import { findDatabase, type Database } from "./database.js";
import type { Profile, QueryRecord } from "./profile.js";
import { getProfile, listProfiles } from "./storage.js";

const ROUTE =
  /^\/api\/profiles\/([0-9a-f]+)\/(?:findings|(fixes)|queries\/(q_\d+)\/(analysis|trial))$/;
const MEMORY = 1000;
const remembered = new Map<string, Finding[]>();

/** The analysis routes, or undefined when the path is none of them. */
export function analysisRoute(request: Request, path: string): Promise<Response> | undefined {
  if (path === "/api/stats/analysis") return sessionRoute(request);
  const match = ROUTE.exec(path);
  if (!match) return undefined;
  const [, token, fixes, queryId, action] = match;
  if (fixes) return fixesRoute(request, token!);
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
    const schema = schemaOf(profile);
    return json(
      Object.fromEntries(profile.queries.map((query) => [query.id, findingsOf(query, schema)])),
    );
  }
  if (method !== (action === "trial" ? "POST" : "GET")) return json({ error: "not_found" }, 404);
  if (!request.headers.has(ANALYSIS_HEADER)) return json({ error: "forbidden" }, 403);
  if (action === "analysis") {
    const measure = new URL(request.url).searchParams.get("measure") === "1";
    return answered(await explainOf(profile, queryId!, measure));
  }
  const body = (await request.json().catch(() => ({}))) as { index?: unknown };
  return answered(await trialOf(profile, queryId!, String(body.index ?? "")));
}

/** Why the database could not be asked, with the HTTP status that says it. */
export interface Refusal {
  error: "not_found" | "no_database" | "no_such_index" | "database_error";
  message?: string;
  status: number;
}

const answered = <T>(result: T | Refusal) =>
  isRefusal(result)
    ? json({ error: result.error, message: result.message }, result.status)
    : json(result);

export const isRefusal = (result: unknown): result is Refusal =>
  typeof result === "object" && result !== null && "status" in result && "error" in result;

/** A query's plan, tables and findings, asked of the connection that ran it. */
export async function explainOf(
  profile: Profile,
  queryId: string,
  measure = false,
): Promise<Analysis | Refusal> {
  const names = prismaNames(schemaOf(profile));
  return asked(profile, queryId, (database, query) =>
    analyzeQuery(database, query, { measure, names }),
  );
}

/** The plan once an index the analysis suggested exists, in a transaction that is rolled back. */
export async function trialOf(
  profile: Profile,
  queryId: string,
  index: string,
): Promise<Trial | NoPlan | Refusal> {
  return asked(profile, queryId, async (database, query) => {
    const analysis = await analyzeQuery(database, query);
    const fix = analysis.findings.find(
      (finding) => finding.fix?.index !== undefined && finding.fix.index === index,
    )?.fix;
    if (!fix?.index || !fix.sql) return { error: "no_such_index", status: 404 } satisfies Refusal;
    return tryIndex(database, query, { name: fix.index, sql: fix.sql });
  });
}

async function asked<T>(
  profile: Profile,
  queryId: string,
  ask: (database: Database, query: QueryRecord) => Promise<T>,
): Promise<T | Refusal> {
  const query = profile.queries.find((each) => each.id === queryId);
  if (!query) return { error: "not_found", status: 404 };
  const database = findDatabase(query.database);
  if (!database)
    return {
      error: "no_database",
      message:
        "The connection that ran this query is gone, or its database is not one the profiler can ask.",
      status: 409,
    };
  try {
    return await ask(database, query);
  } catch (error) {
    return {
      error: "database_error",
      message: error instanceof Error ? error.message : String(error),
      status: 422,
    };
  }
}

/** The code that replaces each N+1 of a profile, with the relations from the app's schema. */
async function fixesRoute(request: Request, token: string): Promise<Response> {
  const profile = getProfile(token);
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "not_found" }, 404);
  if (!profile) return json({ error: "not_found" }, 404);
  return json(fixesOf(profile));
}

/** The app's schema, for the models these profiles use, when the profiler finds it. */
const schemaOf = (...profiles: Profile[]) =>
  findSchema([
    ...new Set(profiles.flatMap((profile) => profile.operations.flatMap((op) => op.model ?? []))),
  ]);

/** A profile's N+1 fixes, with the app's schema when the profiler finds it. */
export const fixesOf = (profile: Profile) => n1Fixes(profile, schemaOf(profile));

/** Every statement shape of the stored requests, analyzed once: it asks the database. */
export function sessionOf(profiles: Profile[]) {
  const names = prismaNames(schemaOf(...profiles));
  return analyzeSession(
    profiles,
    (query) => findDatabase(query.database),
    (database, query) => analyzeQuery(database, query, { names }),
  );
}

async function sessionRoute(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "not_found" }, 404);
  if (!request.headers.has(ANALYSIS_HEADER)) return json({ error: "forbidden" }, 403);
  return json(await sessionOf(listProfiles()));
}

// The same SQL with the same values and rows, and the same schema, always gives the same findings.
function findingsOf(query: QueryRecord, schema: Schema | undefined): Finding[] {
  if (!query.database) return [];
  const key = `${query.database.provider}\u0000${query.sql}\u0000${JSON.stringify(query.params)}\u0000${query.rows}\u0000${schema?.path}:${schema?.changed}`;
  const known = remembered.get(key);
  if (known) return known;
  const findings = readFindings(query, query.database.provider, prismaNames(schema));
  if (remembered.size >= MEMORY) remembered.delete(remembered.keys().next().value!);
  remembered.set(key, findings);
  return findings;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
