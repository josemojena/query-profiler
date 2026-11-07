import { createRequire } from "node:module";
import {
  createMcpHandler,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  explainOf,
  fixesOf,
  isRefusal,
  sessionOf,
  trialOf,
  type Refusal,
} from "./analysis-http.js";
import { detailed, explained, fixed, listed } from "./mcp-views.js";
import type { Profile, ProfileKind } from "./profile.js";
import { projectRoot } from "./root.js";
import { stats } from "./stats.js";
import { getProfile, listProfiles } from "./storage.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };
const KINDS: [ProfileKind, ...ProfileKind[]] = [
  "document",
  "data",
  "action",
  "api",
  "script",
  "startup",
  "task",
  "background",
];
const TOKEN = z
  .string()
  .regex(/^[0-9a-f]{6}$/)
  .describe("A profile's token, from list_requests");
const QUERY = z
  .string()
  .regex(/^q_\d+$/)
  .describe("A query's id, from get_request: q_3");

const INSTRUCTIONS = `query-profiler records every database query this app makes in development: each request, script and task, with its Prisma operations, its SQL, the rows, the time, and the line of code behind each. It flags N+1 loops, slow and duplicate queries.
Start with list_requests (newest first; warnings: true for the ones with problems), then get_request for one. For an N+1, fix_n1 gives the code that replaces the loop and the line to change. For a slow query, explain_query asks the database for its plan and gives the index to add as a schema.prisma line; try_index checks the database would use it. analyze_session and get_stats look across every stored request.
Profiles live in the dev server's memory: the last 100.`;

const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});
const failure = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
const refused = (refusal: Refusal) =>
  failure(refusal.message ?? (refusal.error === "not_found" ? "No such query." : refusal.error));

function withProfile(
  token: string,
  answer: (profile: Profile) => CallToolResult | Promise<CallToolResult>,
) {
  const profile = getProfile(token);
  return profile
    ? answer(profile)
    : failure(`No profile ${token}: it may be gone, the profiler keeps the last 100.`);
}

/** The profiler as an MCP server: its profiles, fixes and analysis, for an AI agent. */
function profilerServer(): McpServer {
  const server = new McpServer({ name: "query-profiler", version }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "list_requests",
    {
      title: "Recent requests",
      description:
        "The requests, scripts and tasks the profiler recorded, newest first: what ran, its status, its queries, the time in the database and its warnings (n+1, slow, duplicate).",
      inputSchema: z.object({
        url: z.string().optional().describe("Only those whose path or name contains this"),
        kind: z.enum(KINDS).optional().describe("Only this kind of profile"),
        warnings: z.boolean().optional().describe("Only those with warnings"),
        limit: z.number().int().min(1).max(100).optional().describe("How many: 20 by default"),
      }),
      annotations: read,
    },
    ({ url, kind, warnings, limit }) =>
      text({
        requests: listProfiles()
          .filter(
            (profile) =>
              (!url || profile.request.url.includes(url)) &&
              (!kind || profile.kind === kind) &&
              (!warnings || profile.warnings.length > 0),
          )
          .slice(0, limit ?? 20)
          .map(listed),
      }),
  );

  server.registerTool(
    "get_request",
    {
      title: "One request",
      description:
        "One profile whole: its warnings, its Prisma operations with their arguments, and each SQL query with its parameters, rows, duration and the line of code that made it.",
      inputSchema: z.object({ token: TOKEN }),
      annotations: read,
    },
    ({ token }) => withProfile(token, (profile) => text(detailed(profile, projectRoot()))),
  );

  server.registerTool(
    "fix_n1",
    {
      title: "Fix the N+1",
      description:
        "For each N+1 of a profile: what repeats, which argument changes each time, which earlier query those values came from, and the Prisma code that replaces the loop (an include, groupBy, findMany with in, createMany, updateMany, deleteMany), best first, with the queries it saves. The relations come from the app's schema.prisma.",
      inputSchema: z.object({ token: TOKEN }),
      annotations: read,
    },
    ({ token }) =>
      withProfile(token, (profile) => {
        const root = projectRoot();
        const fixes = new Map<string, ReturnType<typeof fixed>>();
        // A call that sends several statements has the same fix for each of them.
        for (const [queryId, fix] of Object.entries(fixesOf(profile))) {
          const view = fixed(queryId, fix, root);
          const key = JSON.stringify({ ...view, query: undefined });
          if (!fixes.has(key)) fixes.set(key, view);
        }
        return text({ fixes: [...fixes.values()] });
      }),
  );

  server.registerTool(
    "explain_query",
    {
      title: "Explain a query",
      description:
        "Asks the database for a query's plan, through the connection that ran it: the steps (a table read in full, an index used, a sort), the tables and their indexes, and what the rules find, most severe first, each with its fix (the @@index line for schema.prisma, the SQL, or the change to the query). Estimated by default: nothing runs. measure: true runs a read in a transaction that is rolled back, for the real rows and time of each step.",
      inputSchema: z.object({
        token: TOKEN,
        query: QUERY,
        measure: z.boolean().optional().describe("Run the read, rolled back, to measure it"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ token, query, measure }) =>
      withProfile(token, async (profile) => {
        const result = await explainOf(profile, query, measure ?? false);
        return isRefusal(result) ? refused(result) : text(explained(result));
      }),
  );

  server.registerTool(
    "try_index",
    {
      title: "Try an index",
      description:
        "Creates an index explain_query suggested, by its name, in a transaction that is rolled back, and asks the plan again: whether the database would use it, and the cost without it and with it. PostgreSQL and SQLite only, which can undo a CREATE INDEX.",
      inputSchema: z.object({
        token: TOKEN,
        query: QUERY,
        index: z.string().describe("The index's name, from the fix of an explain_query finding"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ token, query, index }) =>
      withProfile(token, async (profile) => {
        const result = await trialOf(profile, query, index);
        if (isRefusal(result)) return refused(result);
        if ("problem" in result) return failure(result.message);
        const { plan: _plan, ...trial } = result;
        return text(trial);
      }),
  );

  server.registerTool(
    "analyze_session",
    {
      title: "Analyze the session",
      description:
        "Plans every distinct statement of the stored requests once, through its slowest run, and adds them up: the indexes to add, ranked by the time they would fix, what the rules find across the session, and the tables the time goes to. Nothing is run.",
      inputSchema: z.object({}),
      annotations: read,
    },
    async () => text(await sessionOf(listProfiles())),
  );

  server.registerTool(
    "get_stats",
    {
      title: "Stats",
      description:
        "Across the stored requests: the slowest and the most repeated statement shapes, the time by Prisma model and by route.",
      inputSchema: z.object({}),
      annotations: read,
    },
    () => text(stats(listProfiles())),
  );

  return server;
}

// One handler for the process: each HTTP request gets a fresh server from it, as the SDK expects.
let handler: ReturnType<typeof createMcpHandler> | undefined;

/** The MCP endpoint, for agents on this machine; a page of another site is turned away. */
export function mcpRoute(request: Request): Promise<Response> {
  const rejected = originValidationResponse(request, localhostAllowedOrigins());
  if (rejected) return Promise.resolve(rejected);
  handler ??= createMcpHandler(() => profilerServer());
  return handler.fetch(request);
}
