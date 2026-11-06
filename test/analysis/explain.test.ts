import { describe, expect, it } from "vitest";
import { atLeast, explain, statementKind } from "../../src/analysis/explain.js";
import type { Database, RunSql } from "../../src/core/index.js";

/** A connection that answers the version and an empty plan, and keeps what it was sent. */
function fakeDatabase(provider: Database["provider"], version: string) {
  const sent: { sql: string; params: unknown[] }[] = [];
  const run: RunSql = async (sql, params = []) => {
    sent.push({ sql, params });
    if (!sql.startsWith("EXPLAIN")) return { columns: ["version"], rows: [[version]] };
    return {
      columns: ["EXPLAIN"],
      rows: [
        [
          JSON.stringify(
            provider === "postgres" ? [{ Plan: { "Node Type": "Result" } }] : { query_block: {} },
          ),
        ],
      ],
    };
  };
  const database: Database = { id: `${provider}#1`, provider, run, rolledBack: (fn) => fn(run) };
  return { database, sent: () => sent.filter((call) => call.sql.startsWith("EXPLAIN")) };
}

describe("the parameters an EXPLAIN is sent", () => {
  it("gives LIMIT and OFFSET back the number recorded as text, and leaves other text alone", async () => {
    const mysql = fakeDatabase("mysql", "8.4.3");
    await explain(mysql.database, {
      sql: "SELECT `id` FROM `User` WHERE `name` = ? AND `code` = '?' LIMIT ? OFFSET ?",
      params: ["123", "1", "0"],
    });
    expect(mysql.sent()[0]!.params).toEqual(["123", 1, 0]);
    const postgres = fakeDatabase("postgres", "18.1");
    await explain(postgres.database, {
      sql: 'SELECT "id" FROM "User" WHERE "name" = $1 LIMIT $2 OFFSET $3',
      params: ["7", "10", "20"],
    });
    expect(postgres.sent()[0]!.params).toEqual(["7", 10, 20]);
  });

  it("writes a date in MySQL's own format, not as the ISO text it was recorded as", async () => {
    const mysql = fakeDatabase("mysql", "8.4.3");
    await explain(mysql.database, {
      sql: "SELECT `id` FROM `Post` WHERE `createdAt` > ?",
      params: ["2026-11-06T09:30:00.250Z"],
    });
    expect(mysql.sent()[0]!.params).toEqual(["2026-11-06 09:30:00.250"]);
  });

  it("plans without values on PostgreSQL 16 or later when a value was hidden, and with a stand-in before", async () => {
    const hidden = { sql: 'SELECT 1 FROM "User" WHERE "password" = $1', params: ["[redacted]"] };
    const recent = fakeDatabase("postgres", "16.4");
    expect(await explain(recent.database, hidden)).toMatchObject({
      generic: true,
      approximate: false,
    });
    expect(recent.sent()[0]).toMatchObject({
      sql: expect.stringContaining("GENERIC_PLAN"),
      params: [],
    });
    const older = fakeDatabase("postgres", "15.8");
    expect(await explain(older.database, hidden)).toMatchObject({
      generic: false,
      approximate: true,
    });
  });
});

describe("what kind of statement a query is", () => {
  it("tells reads, writes and the rest apart, past comments and parentheses", () => {
    expect(statementKind("/* list */ SELECT 1")).toBe("read");
    expect(statementKind("(SELECT 1) UNION (SELECT 2)")).toBe("read");
    expect(statementKind("WITH a AS (SELECT 1) SELECT * FROM a")).toBe("read");
    expect(statementKind("WITH a AS (DELETE FROM t RETURNING id) SELECT * FROM a")).toBe("write");
    expect(statementKind("WITH a AS (SELECT 'delete') SELECT * FROM a")).toBe("read");
    expect(statementKind("UPDATE t SET a = 1")).toBe("write");
    expect(statementKind("BEGIN")).toBeUndefined();
    expect(statementKind("CREATE INDEX i ON t (a)")).toBeUndefined();
  });
});

describe("version comparison", () => {
  it("compares part by part, missing parts counting as zero", () => {
    expect(atLeast("16.4", "16")).toBe(true);
    expect(atLeast("15.10", "16")).toBe(false);
    expect(atLeast("8.0.18", "8.0.18")).toBe(true);
    expect(atLeast("8.0.9", "8.0.18")).toBe(false);
    expect(atLeast("11", "10.11")).toBe(true);
  });
});

describe("measuring a query", () => {
  it("never runs a locking read, and stops a PostgreSQL one after 10 seconds", async () => {
    const mysql = fakeDatabase("mysql", "8.4.3");
    for (const sql of [
      "SELECT id FROM t WHERE a = ? FOR UPDATE",
      "SELECT id FROM t LOCK IN SHARE MODE",
      "SELECT id FROM t FOR SHARE",
    ])
      expect(await explain(mysql.database, { sql, params: [1] }, { measure: true })).toMatchObject({
        problem: "not_measurable",
      });
    const postgres = fakeDatabase("postgres", "18.1");
    const calls: string[] = [];
    const database = {
      ...postgres.database,
      rolledBack: <T>(fn: (run: RunSql) => Promise<T>) =>
        fn(async (sql, params) => {
          calls.push(sql);
          return postgres.database.run(sql, params);
        }),
    };
    await explain(database, { sql: "SELECT 1", params: [] }, { measure: true });
    expect(calls[0]).toBe("SET LOCAL statement_timeout = '10s'");
  });
});
