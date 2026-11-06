import { describe, expect, it } from "vitest";
import { RULES } from "../../src/analysis/analyze.js";
import { readCatalog } from "../../src/analysis/catalog.js";
import type { Plan } from "../../src/analysis/plan.js";
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
              values: { wrapper: "lower()", index: "i" },
              advice: {
                table: { name: "t" },
                columns: [{ name: "a" }],
                name: "t_a_idx",
                prisma: "@@index([a])",
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
