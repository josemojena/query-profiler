import { describe, expect, it } from "vitest";
import type { Analysis, Finding } from "../../src/analysis/analyze.js";
import { analyzeSession } from "../../src/analysis/session.js";
import type { Database, Profile, QueryRecord } from "../../src/core/index.js";

const database = { id: "postgres#1", provider: "postgres" as const };
const connection = {} as Database;

let ids = 0;
const query = (
  fingerprint: string,
  sql: string,
  durationMs: number,
  extra: Partial<QueryRecord> = {},
): QueryRecord => ({
  id: `q_${++ids}`,
  sql,
  params: [],
  fingerprint,
  startMs: 0,
  durationMs,
  database,
  ...extra,
});

const profile = (token: string, url: string, queries: QueryRecord[]): Profile => ({
  schemaVersion: 1,
  token,
  kind: "document",
  request: { method: "GET", url },
  startedAt: 0,
  framework: { name: "test" },
  operations: [],
  queries,
  warnings: [],
  summary: { queryCount: queries.length, dbTimeMs: 0, operationCount: 0, errorCount: 0 },
});

const indexFinding = (columns: string[]): Finding => ({
  rule: "full-scan-missing-index",
  severity: "problem",
  about: "query",
  message: `Reads every row of Post to find the ones it wants: no index has ${columns.join(", ")}.`,
  fix: {
    kind: "index",
    text: "",
    index: `Post_${columns.join("_")}_idx`,
    on: { table: "Post", columns },
    prisma: `@@index([${columns.join(", ")}])`,
    sql: "CREATE INDEX …",
  },
});
const note: Finding = {
  rule: "foreign-key-without-index",
  severity: "warning",
  about: "table",
  message: "Post.authorId references User with no index.",
};
const analysis = (findings: Finding[], tables = ["Post"]): Analysis => ({
  engine: "postgres",
  version: "18.1",
  tables: tables.map((name) => ({
    name,
    analyzed: true,
    columns: [],
    indexes: [],
    foreignKeys: [],
  })),
  findings,
  plan: {
    engine: "postgres",
    version: "18.1",
    measured: false,
    generic: false,
    approximate: false,
    raw: "",
    steps: [{ label: "Seq Scan", kind: "read", relation: "Post", access: "full", children: [] }],
  },
});

describe("the session's analysis", () => {
  it("analyzes each statement shape once and keeps the index that serves the others too, ranked by time", async () => {
    const byAuthor = (ms: number) => query("a", `SELECT * FROM "Post" WHERE "authorId" = $1`, ms);
    const page = query("b", `SELECT * FROM "Post" WHERE "authorId" = $1 ORDER BY "createdAt"`, 50);
    const skip = query("c", `SELECT * FROM "Post" OFFSET $1`, 2);
    const profiles = [
      profile("aaaaaa", "/posts?page=2", [byAuthor(10), byAuthor(5), page, query("t", "BEGIN", 1)]),
      profile("bbbbbb", "/", [byAuthor(15), skip, { ...skip, id: "q_99" }]),
    ];
    const answers: Record<string, Analysis> = {
      a: analysis([indexFinding(["authorId"]), note]),
      b: analysis([indexFinding(["authorId", "createdAt"]), note]),
      c: analysis([
        { rule: "deep-offset", severity: "warning", about: "query", message: "Skips 5,000 rows." },
      ]),
    };
    const asked: string[] = [];
    const session = await analyzeSession(
      profiles,
      () => connection,
      async (_, each) => {
        asked.push(each.fingerprint);
        return answers[each.fingerprint]!;
      },
    );
    expect(asked.sort()).toEqual(["a", "b", "c"]);
    expect(session).toMatchObject({ shapes: 3, analyzed: 3, skipped: 0, failed: [] });
    expect(session.indexes).toHaveLength(1);
    expect(session.indexes[0]).toMatchObject({
      columns: ["authorId", "createdAt"],
      covers: ["Post_authorId_idx"],
      runs: 4,
      totalMs: 80,
      routes: ["/posts", "/"],
    });
    expect(session.indexes[0]!.shapes.map((shape) => shape.fingerprint)).toEqual(["b", "a"]);
    expect(session.rules.map((rule) => [rule.rule, rule.shapes, rule.runs])).toEqual([
      ["full-scan-missing-index", 2, 4],
      ["deep-offset", 1, 2],
    ]);
    expect(session.notes).toEqual([note]);
    expect(session.tables).toEqual([
      { table: "Post", shapes: 3, runs: 6, totalMs: 84, fullReads: 3 },
    ]);
  });

  it("counts what it could not ask about, and what the database refused", async () => {
    const orphan = query("d", "SELECT 1 FROM t", 1, { database: undefined });
    const broken = query("e", `SELECT nope FROM "Post"`, 1);
    const session = await analyzeSession(
      [profile("cccccc", "/", [orphan, broken])],
      (each) => (each.database ? connection : undefined),
      async () => {
        throw new Error('column "nope" does not exist');
      },
    );
    expect(session).toMatchObject({
      shapes: 2,
      analyzed: 0,
      skipped: 1,
      failed: [{ message: 'column "nope" does not exist' }],
    });
  });
});
