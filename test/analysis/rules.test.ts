import { describe, expect, it } from "vitest";
import { RULES, readFindings } from "../../src/analysis/analyze.js";
import { readCatalog } from "../../src/analysis/catalog.js";
import type { Table } from "../../src/analysis/catalog.js";
import type { Engine, Plan, PlanStep } from "../../src/analysis/plan.js";
import { readPostgresPlan } from "../../src/analysis/plans/postgres.js";
import {
  appliesTo,
  factsOf,
  fill,
  holds,
  parseWhen,
  type SubjectKind,
} from "../../src/analysis/rules/engine.js";
import { fixFor } from "../../src/analysis/rules/fixes.js";
import { subjects } from "../../src/analysis/rules/subjects.js";
import { readStatement } from "../../src/analysis/statement.js";
import { readFileSync } from "node:fs";

const ENGINES = new Set(["postgres", "mysql", "mariadb", "sqlite"]);

// One query whose plan, conditions and tables give every kind of subject, to learn each kind's facts.
async function everySubject() {
  const sql = `SELECT u.id FROM "User" u JOIN "Order" o ON o."userId" = u.id WHERE u.email LIKE $1 AND o.total IN ($2, $3) ORDER BY o.total LIMIT 10`;
  const plan: Plan = {
    engine: "postgres",
    version: "18.1",
    measured: false,
    generic: false,
    approximate: false,
    steps: [
      {
        label: "Sort",
        kind: "sort",
        keys: ["o.total"],
        children: [
          { label: "HashAggregate", kind: "group", children: [] },
          ...readPostgresPlan(
            JSON.parse(readFileSync(new URL("plans/postgres-join.json", import.meta.url), "utf8")),
          ),
        ],
      },
    ],
    raw: "",
  };
  const tables = await readCatalog(
    async (query) => {
      if (query.includes("pg_class c"))
        return { columns: [], rows: [["public", "Order", 10, 8192, 10, true, "public"]] };
      if (query.includes("pg_index ix"))
        return {
          columns: [],
          rows: [
            [
              "public",
              "Order",
              "Order_total_idx",
              false,
              false,
              "btree",
              null,
              "total",
              null,
              false,
              true,
            ],
            [
              "public",
              "Order",
              "Order_total_id_idx",
              false,
              false,
              "btree",
              null,
              "total\u001fid",
              null,
              false,
              true,
            ],
          ],
        };
      if (query.includes("pg_constraint"))
        return {
          columns: [],
          rows: [["public", "Order", "Order_userId_fkey", "userId", "User", "id"]],
        };
      return { columns: [], rows: [] };
    },
    "postgres",
    [{ name: "Order" }],
  );
  return subjects({
    engine: "postgres",
    statement: readStatement(sql, "postgres"),
    plan,
    tables,
    params: ["%a", 1, 2],
  });
}

describe("every rule", () => {
  it("is well formed: a known subject and engines, facts and values its subject has, a known fix", async () => {
    const found = await everySubject();
    const kinds = new Map<SubjectKind, { facts: Set<string>; values: Set<string> }>();
    for (const subject of found)
      kinds.set(subject.kind, {
        facts: new Set(Object.keys(subject.facts)),
        values: new Set(Object.keys(subject.values)),
      });
    const ids = new Set<string>();
    for (const [id, kind, engines, when, severity, message, fix, docs] of RULES) {
      const own = kinds.get(kind);
      expect(own, `${id}: no subject of kind ${kind}`).toBeDefined();
      expect(id).toMatch(/^[a-z]+(?:-[a-z0-9]+)*$/);
      for (const fact of factsOf(parseWhen(when)))
        expect(own!.facts, `${id} uses ${fact}`).toContain(fact);
      for (const [, value] of message.matchAll(/\{(\w+)\}/g))
        expect(own!.values, `${id} shows ${value}`).toContain(value);
      if (engines !== "*")
        for (const entry of engines.split(" "))
          expect(ENGINES, `${id}: ${entry}`).toContain(entry.split("@")[0]);
      expect(["problem", "warning", "info"]).toContain(severity);
      if (fix)
        expect(
          fixFor(
            fix,
            {
              kind,
              facts: {},
              values: { wrapper: "lower()", expression: "lower(a)", index: "i", related: "a, b" },
              advice: {
                table: { name: "t" },
                columns: [{ name: "a" }],
                name: "t_a_idx",
                sql: "CREATE INDEX",
              },
            },
            "postgres",
          ),
          `${id}: fix ${fix}`,
        ).toBeDefined();
      if (docs) expect(docs).toMatch(/^https:\/\//);
      ids.add(`${id} ${engines}`);
    }
    expect(ids.size, "an id repeats only for other engines").toBe(RULES.length);
  });
});

describe("a rule's condition", () => {
  it("reads facts, ! before &, & before |, and parentheses", () => {
    const facts = { a: true, b: false, c: true };
    expect(holds(parseWhen("a | b & c"), { ...facts, a: false })).toBe(false);
    expect(holds(parseWhen("(a | b) & c"), facts)).toBe(true);
    expect(holds(parseWhen("!b & a"), facts)).toBe(true);
    expect(holds(parseWhen("!(a & c)"), facts)).toBe(false);
    expect(factsOf(parseWhen("full & missing & !small"))).toEqual(["full", "missing", "small"]);
  });

  it("refuses what it cannot read", () => {
    for (const when of ["a &", "& a", "a b", "(a", "a)", "a + b", ""])
      expect(() => parseWhen(when)).toThrow();
  });
});

describe("a rule's engines", () => {
  it("names engines, each with an optional first or last version", () => {
    expect(appliesTo("*", "sqlite", "3.45")).toBe(true);
    expect(appliesTo("mysql mariadb", "mariadb", "11.4")).toBe(true);
    expect(appliesTo("mysql", "mariadb", "11.4")).toBe(false);
    expect(appliesTo("postgres@16", "postgres", "15.8")).toBe(false);
    expect(appliesTo("postgres@16", "postgres", "16.0")).toBe(true);
    expect(appliesTo("postgres@<18", "postgres", "18.1")).toBe(false);
    expect(appliesTo("postgres@<18", "postgres", "17.6")).toBe(true);
  });
});

describe("a rule's message", () => {
  it("fills each placeholder, with thousands marked in numbers", () => {
    expect(fill("Read {removed} rows of {table}", { removed: 19999, table: "Post" })).toBe(
      "Read 19,999 rows of Post",
    );
    expect(fill("{missing} stays", {})).toBe("{missing} stays");
  });
});

describe("the facts of a measured read", () => {
  const read = (rows: number, loops: number, estimated: number, limit = false) => {
    const sql = `SELECT id FROM t WHERE a = $1${limit ? " LIMIT 10" : ""}`;
    const plan: Plan = {
      engine: "mysql",
      version: "8.4.3",
      measured: true,
      generic: false,
      approximate: false,
      steps: [
        {
          label: "ALL",
          kind: "read",
          table: "t",
          access: "full",
          rows: estimated,
          measured: { rows, loops },
          children: [],
        },
      ],
      raw: "",
    };
    const [subject] = subjects({
      engine: "mysql",
      statement: readStatement(sql, "postgres"),
      plan,
      tables: [],
      params: [1],
    });
    return subject!.facts;
  };

  it("compares the estimate per loop with what each loop found", () => {
    expect(read(20_000, 100, 200).misestimated).toBe(false);
    expect(read(20_000, 100, 2).misestimated).toBe(true);
    expect(read(0, 0, 500).misestimated).toBe(false);
  });

  it("does not compare under a LIMIT, which stops the reading early", () => {
    expect(read(10, 1, 5000, true).misestimated).toBe(false);
  });
});

describe("the facts of a table's indexes", () => {
  it("sees an index as a duplicate only when its key parts match, direction and operator class too", async () => {
    const catalog = (definitions: string[]) =>
      readCatalog(
        async (query) => {
          if (query.includes("pg_class c"))
            return { columns: [], rows: [["public", "t", 10, 8192, 10, true, "public"]] };
          if (query.includes("pg_index ix"))
            return {
              columns: [],
              rows: definitions.map((definition, at) => [
                "public",
                "t",
                `t_${at}`,
                false,
                false,
                "btree",
                null,
                "email",
                null,
                false,
                at !== 2,
                definition,
              ]),
            };
          return { columns: [], rows: [] };
        },
        "postgres",
        [{ name: "t" }],
      );
    const tables = await catalog([
      "CREATE INDEX t_0 ON public.t USING btree (email)",
      "CREATE INDEX t_1 ON public.t USING btree (email text_pattern_ops)",
      "CREATE INDEX t_2 ON public.t USING btree (email)",
    ]);
    const found = subjects({
      engine: "postgres",
      statement: readStatement("SELECT 1 FROM t", "postgres"),
      tables,
      params: [],
    });
    const flags = found
      .filter((each) => each.kind === "index")
      .map((each) => [each.values.index, each.facts.duplicate]);
    // t_2 failed to build (invalid): it is neither a duplicate nor what makes one.
    expect(flags).toEqual([
      ["t_0", false],
      ["t_1", false],
      ["t_2", false],
    ]);
  });
});

describe("the expression index fix", () => {
  const fix = (expression: string, engine: Engine, version = "") =>
    fixFor(
      "expression-index",
      {
        kind: "condition",
        facts: {},
        values: { expression },
        table: { name: "t" },
        column: "data",
      },
      engine,
      version,
    );

  it("indexes the whole call where the engine can, and says how otherwise", () => {
    expect(fix("json_extract(data, '$.a')", "mysql", "8.4.3")!.sql).toBe(
      "CREATE INDEX `t_data_json_extract_idx` ON `t` ((json_extract(data, '$.a')));",
    );
    expect(fix("json_extract(data, '$.a')", "mysql", "8.0.12")).not.toHaveProperty("sql");
    expect(fix("lower(data)", "mariadb", "11.4.4")!.text).toContain("generated column");
    // now() and the like give another result each time: no index can hold them.
    expect(fix("my_function(data)", "postgres", "18.1")).not.toHaveProperty("sql");
  });
});

describe("the facts PostgreSQL's manual adds", () => {
  const facts = (
    kind: SubjectKind,
    context: Partial<Parameters<typeof subjects>[0]> & { sql: string },
  ) => {
    const { sql, ...rest } = context;
    const found = subjects({
      engine: "postgres",
      statement: readStatement(sql, "postgres"),
      tables: [],
      params: [],
      ...rest,
    });
    return found.filter((subject) => subject.kind === kind);
  };
  const table = (extra: Partial<Table> = {}): Table => ({
    schema: "public",
    name: "t",
    rows: 50_000,
    analyzed: true,
    columns: [],
    indexes: [],
    foreignKeys: [],
    ...extra,
  });
  const plan = (steps: PlanStep[], extra: Partial<Plan> = {}): Plan => ({
    engine: "postgres",
    version: "18.1",
    measured: true,
    generic: false,
    approximate: false,
    steps,
    raw: "",
    ...extra,
  });
  const read = (extra: Partial<PlanStep> = {}): PlanStep => ({
    label: "Seq Scan",
    kind: "read",
    table: "t",
    relation: "t",
    access: "full",
    rows: 10,
    children: [],
    ...extra,
  });

  it("tells statistics that changed more rows than autovacuum waits for", () => {
    const [stale] = facts("read", {
      sql: "SELECT 1 FROM t WHERE a = $1",
      params: [1],
      plan: plan([read()]),
      tables: [table({ modified: 6000, analyzeAfter: 5050 })],
    });
    expect(stale!.facts.stale).toBe(true);
    const [fresh] = facts("read", {
      sql: "SELECT 1 FROM t WHERE a = $1",
      params: [1],
      plan: plan([read()]),
      tables: [table({ modified: 10, analyzeAfter: 5050 })],
    });
    expect(fresh!.facts.stale).toBe(false);
  });

  it("tells related columns the planner takes for independent, unless extended statistics cover them", () => {
    const sql = "SELECT 1 FROM t WHERE a = $1 AND b = $2";
    const [plain] = facts("read", { sql, params: [1, 2], plan: plan([read()]), tables: [table()] });
    expect(plain!.facts.correlated).toBe(true);
    const covered = table({ statistics: [{ name: "t_a_b", columns: ["a", "b"] }] });
    const [known] = facts("read", { sql, params: [1, 2], plan: plan([read()]), tables: [covered] });
    expect(known!.facts.correlated).toBe(false);
  });

  it("tells an index-only read that still checks the table, and a hash that went to disk", () => {
    const covering = read({
      label: "Index Only Scan",
      access: "index-only",
      index: "t_a",
      lookup: "(a = 1)",
      measured: { rows: 5000, loops: 1, heapFetches: 5000 },
    });
    const [visits] = facts("read", {
      sql: "SELECT a FROM t WHERE a = 1",
      plan: plan([covering]),
      tables: [table()],
    });
    expect(visits!.facts.heapVisits).toBe(true);
    const hashed: PlanStep = {
      label: "Hash Join (Inner)",
      kind: "join",
      children: [
        read({ table: "u", relation: "u" }),
        { label: "Hash", kind: "other", batches: 8, children: [read()] },
      ],
    };
    const reads = facts("read", {
      sql: "SELECT 1 FROM t JOIN u ON u.id = t.id",
      plan: plan([hashed]),
      tables: [table()],
    });
    expect(reads.map((each) => each.facts.hashSpill)).toEqual([false, true]);
  });

  it("tells a query that counts every row, pages with no order, or spends its time planning or compiling", () => {
    const [count] = facts("query", { sql: `SELECT COUNT(*) FROM t`, tables: [table()] });
    expect(count!.facts.countsAll).toBe(true);
    const [filtered] = facts("query", {
      sql: `SELECT COUNT(*) FROM t WHERE a = $1`,
      params: [1],
      tables: [table()],
    });
    expect(filtered!.facts.countsAll).toBe(false);
    const [paged] = facts("query", {
      sql: "SELECT id FROM t LIMIT $1 OFFSET $2",
      params: ["10", "20"],
    });
    expect(paged!.facts).toMatchObject({ paged: true, unordered: true });
    const [first] = facts("query", {
      sql: "SELECT id FROM t LIMIT $1 OFFSET $2",
      params: ["10", "0"],
    });
    expect(first!.facts.paged).toBe(false);
    const [slow] = facts("query", {
      sql: "SELECT 1",
      plan: plan([], { timing: { planningMs: 12, executionMs: 3, jitMs: 1 } }),
    });
    expect(slow!.facts).toMatchObject({ planningHeavy: true, jitHeavy: true });
  });

  it("tells a pattern too short for a trigram index, a NOT IN with a NULL, and a parameter on a partial index's column", () => {
    const [short] = facts("condition", {
      sql: `SELECT 1 FROM t WHERE name ILIKE ('%' || $1 || '%')`,
      params: ["ab"],
    });
    expect(short!.facts.fewTrigrams).toBe(true);
    const [long] = facts("condition", {
      sql: `SELECT 1 FROM t WHERE name ILIKE ('%' || $1 || '%')`,
      params: ["abc"],
    });
    expect(long!.facts.fewTrigrams).toBe(false);
    const [nulls] = facts("condition", {
      sql: `SELECT 1 FROM t WHERE id NOT IN ($1, NULL)`,
      params: [1],
    });
    expect(nulls!.facts.nullInList).toBe(true);
    const [nullParam] = facts("condition", {
      sql: `SELECT 1 FROM t WHERE id NOT IN ($1, $2)`,
      params: [1, null],
    });
    expect(nullParam!.facts.nullInList).toBe(true);
    const partial = table({
      indexes: [
        {
          name: "t_open",
          columns: ["at"],
          unique: false,
          primary: false,
          expression: false,
          where: "(status = 'open'::text)",
        },
      ],
    });
    const [onStatus] = facts("condition", {
      sql: `SELECT 1 FROM t WHERE status = $1`,
      params: ["open"],
      tables: [partial],
    });
    expect(onStatus!.values).toMatchObject({ index: "t_open" });
    expect(onStatus!.facts.partialParam).toBe(true);
  });

  it("tells an index that has the column after another, which cannot look it up", () => {
    const buriedIn = table({
      indexes: [
        { name: "t_b_a", columns: ["b", "a"], unique: false, primary: false, expression: false },
      ],
    });
    const [subject] = facts("read", {
      sql: "SELECT 1 FROM t WHERE a = $1",
      params: [1],
      plan: plan([read()]),
      tables: [buriedIn],
    });
    expect(subject!.facts).toMatchObject({ buried: true, missing: true });
    expect(subject!.values).toMatchObject({ buriedIn: "t_b_a", leading: "b" });
  });
});

describe("a full read of an index", () => {
  it("is fine up to a LIMIT, which stops it once it has the rows", () => {
    const read = (sql: string) =>
      subjects({
        engine: "postgres",
        statement: readStatement(sql, "postgres"),
        plan: {
          engine: "postgres",
          version: "18.1",
          measured: false,
          generic: false,
          approximate: false,
          raw: "",
          steps: [
            {
              label: "Index Scan",
              kind: "read",
              table: "t",
              relation: "t",
              access: "index-full",
              index: "t_pkey",
              filter: "(a = 1)",
              rows: 5000,
              children: [],
            },
          ],
        },
        tables: [],
        params: [],
      })[0]!.facts;
    expect(read("SELECT id FROM t WHERE a = 1 ORDER BY id LIMIT 5").limited).toBe(true);
    expect(read("SELECT id FROM t WHERE a = 1 ORDER BY id").limited).toBe(false);
  });
});

describe("a full read that keeps many rows", () => {
  it("is what an index would cost too, so it is no index skipped", () => {
    const facts = (rows: number) =>
      subjects({
        engine: "postgres",
        statement: readStatement("SELECT id FROM t WHERE flag = $1", "postgres"),
        plan: {
          engine: "postgres",
          version: "18.1",
          measured: false,
          generic: false,
          approximate: false,
          raw: "",
          steps: [
            {
              label: "Seq Scan",
              kind: "read",
              table: "t",
              relation: "t",
              access: "full",
              filter: "(flag = true)",
              rows,
              children: [],
            },
          ],
        },
        tables: [
          {
            schema: "public",
            name: "t",
            rows: 60_000,
            analyzed: true,
            columns: [],
            foreignKeys: [],
            indexes: [
              {
                name: "t_flag",
                columns: ["flag"],
                unique: false,
                primary: false,
                expression: false,
              },
            ],
          },
        ],
        params: [true],
      })[0]!;
    expect(facts(40_000)).toMatchObject({
      facts: { served: true, broad: true },
      values: { share: 67 },
    });
    expect(facts(600).facts.broad).toBe(false);
  });
});

describe("the rows a query returned", () => {
  const rules = (sql: string, rows: number) =>
    readFindings({ sql, params: [], rows }, "postgres").map((finding) => finding.rule);

  it("flag a read with no limit that returned a thousand rows or more", () => {
    const [finding] = readFindings(
      { sql: 'SELECT "id", "title" FROM "Post" WHERE "createdAt" >= $1', params: [], rows: 1600 },
      "postgres",
    ).filter((each) => each.rule === "many-rows");
    expect(finding).toMatchObject({
      severity: "warning",
      message:
        "Returned 1,600 rows with no limit: if the page shows fewer, take or a cursor reads only those.",
    });
  });

  it("leave a read with a limit, a smaller one, and a write alone", () => {
    expect(rules('SELECT "id" FROM "Post" LIMIT $1', 5000)).not.toContain("many-rows");
    expect(rules('SELECT "id" FROM "Post"', 999)).not.toContain("many-rows");
    expect(rules('UPDATE "Post" SET "views" = 0 WHERE "published" = true', 5000)).not.toContain(
      "many-rows",
    );
  });
});
