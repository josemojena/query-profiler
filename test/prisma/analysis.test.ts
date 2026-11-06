import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeQuery, tryIndex, type Analysis } from "../../src/analysis/analyze.js";
import {
  endProfile,
  findDatabase,
  runWithProfile,
  startProfile,
  type QueryRecord,
} from "../../src/core/index.js";
import { profilePrisma } from "../../src/prisma/index.js";
import { analysisFixture, dropAnalysisFixture } from "./analysis-fixture.js";
import { ENGINES } from "./engines.js";

async function recorded(fn: () => Promise<unknown>): Promise<QueryRecord> {
  const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
  await runWithProfile(active, async () => {
    await fn();
  });
  return endProfile(active, { status: 200 }).queries.at(-1)!;
}

const rules = (analysis: Analysis) => analysis.findings.map((finding) => finding.rule);
const finding = (analysis: Analysis, rule: string) =>
  analysis.findings.find((each) => each.rule === rule);

describe.each(ENGINES)("%s", (engine, connect) => {
  const prisma = profilePrisma(connect());
  const p = (position: number) => (engine === "postgres" ? `$${position}` : "?");
  const innodb = engine === "mysql" || engine === "mariadb";

  beforeAll(async () => {
    for (const sql of [...dropAnalysisFixture(), ...analysisFixture(engine)])
      await prisma.$executeRawUnsafe(sql);
  }, 60_000);
  afterAll(async () => {
    for (const sql of dropAnalysisFixture()) await prisma.$executeRawUnsafe(sql);
    await prisma.$disconnect();
  });

  async function analyze(sql: string, params: unknown[] = [], options = {}) {
    const query = await recorded(() => prisma.$queryRawUnsafe(sql, ...params));
    return { query, analysis: await analyzeQuery(findDatabase(query.database)!, query, options) };
  }

  it("finds a full read of a big table for want of an index, and writes that index", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_post WHERE title = ${p(1)}`, ["Post 77"]);
    const full = finding(analysis, "full-scan-missing-index")!;
    expect(full).toMatchObject({ severity: "problem", table: "qp_post" });
    expect(full.message).toContain("title");
    expect(full.fix).toMatchObject({ prisma: "@@index([title])" });
    expect(full.fix!.sql).toMatch(
      /^CREATE INDEX ["`]qp_post_title_idx["`] ON .*qp_post["`] \(["`]title["`]\);$/,
    );
    expect(full.step).toBeGreaterThanOrEqual(0);
  });

  it("says nothing about how a read through an index reads", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_post WHERE id = ${p(1)}`, [77]);
    expect(analysis.findings.filter((each) => each.step !== undefined)).toEqual([]);
  });

  it("finds the join's missing index on the foreign key, which InnoDB creates by itself", async () => {
    const { analysis } = await analyze(
      `SELECT p.id FROM qp_author a JOIN qp_post p ON p.author_id = a.id WHERE a.email = ${p(1)}`,
      ["author5@example.test"],
    );
    const onAuthor = analysis.findings.filter(
      (each) => each.table === "qp_post" && each.fix?.prisma === "@@index([author_id])",
    );
    expect(onAuthor.length > 0).toBe(!innodb);
    expect(rules(analysis).includes("foreign-key-without-index")).toBe(!innodb);
  });

  it("puts a filtered join's missing index where the plan reads in full, not on the key it joins by", async () => {
    const { analysis } = await analyze(
      `SELECT p.id FROM qp_author a JOIN qp_post p ON p.author_id = a.id WHERE a.email = ${p(1)}`,
      ["author5@example.test"],
    );
    // SQLite reads every post and finds each author by its key; the others read every author.
    const [table, prisma] =
      engine === "sqlite" ? ["qp_post", "@@index([author_id])"] : ["qp_author", "@@index([email])"];
    const fixes = analysis.findings.filter((each) => each.table === table);
    expect(fixes.map((each) => each.fix?.prisma)).toContain(prisma);
    expect(rules(analysis)).not.toContain("full-scan-index-skipped");
  });

  it("asks nothing of a join that has to read both tables whole", async () => {
    const { analysis } = await analyze(
      `SELECT a.id FROM qp_author a JOIN qp_post p ON p.title = a.name`,
    );
    const about = analysis.findings
      .filter((each) => each.about === "query")
      .map((each) => each.rule);
    // Only SQLite does worse than hash the rows: it builds an index for the join on every run.
    expect(about).toEqual(engine === "sqlite" ? ["automatic-index"] : []);
  });

  it("finds a sort an index would avoid, and the index that gives the rows in order", async () => {
    const { analysis } = await analyze(
      `SELECT id FROM qp_post WHERE status = ${p(1)} ORDER BY title LIMIT 10`,
      ["draft"],
    );
    expect(finding(analysis, "sort-without-index")?.fix?.prisma).toBe("@@index([status, title])");
  });

  it("finds a LIKE with % first, with each engine's way to search inside text", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_author WHERE name LIKE ${p(1)}`, [
      "%son",
    ]);
    const kinds = {
      postgres: "trigram",
      mysql: "fulltext",
      mariadb: "fulltext",
      sqlite: "full-text",
    };
    expect(finding(analysis, "leading-wildcard")?.fix?.kind).toBe(kinds[engine]);
  });

  it("finds a function on a filtered column, with the expression index to add", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_author WHERE lower(email) = ${p(1)}`, [
      "a",
    ]);
    const wrapped = finding(analysis, "function-on-column")!;
    expect(wrapped.message).toContain("lower()");
    if (engine === "mariadb") expect(wrapped.fix!.text).toContain("generated column");
    else expect(wrapped.fix!.sql).toMatch(/\(\(lower\(["`]email["`]\)\)\);$/);
  });

  it("finds a deep OFFSET and a NOT IN over a subquery", async () => {
    const { analysis: page } = await analyze(
      `SELECT id FROM qp_post ORDER BY id LIMIT 10 OFFSET 5000`,
    );
    expect(finding(page, "deep-offset")).toMatchObject({ fix: { kind: "keyset" } });
    const { analysis: notIn } = await analyze(
      `SELECT id FROM qp_author WHERE id NOT IN (SELECT author_id FROM qp_post WHERE status = ${p(1)})`,
      ["draft"],
    );
    expect(rules(notIn)).toContain("not-in-subquery");
  });

  it("finds a redundant index and a duplicate one on the tables a query reads, as about the table", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_post WHERE id = ${p(1)}`, [1]);
    expect(finding(analysis, "redundant-index")).toMatchObject({
      about: "table",
      message: expect.stringContaining("qp_post_status_idx"),
    });
    expect(finding(analysis, "duplicate-index")!.message).toContain("qp_post_views_b");
  });

  it.runIf(engine === "postgres" || engine === "sqlite")(
    "says a table has no statistics to plan with",
    async () => {
      const { analysis } = await analyze(`SELECT id FROM qp_fresh WHERE kind = ${p(1)}`, [
        "kind 3",
      ]);
      expect(finding(analysis, "never-analyzed")!.fix!.sql).toMatch(/^ANALYZE ["`]qp_fresh["`];$/);
      const { analysis: analyzed } = await analyze(
        `SELECT id FROM qp_post WHERE id = ${p(1)}`,
        [1],
      );
      expect(rules(analyzed)).not.toContain("never-analyzed");
    },
  );

  it.skipIf(engine === "sqlite")("measures the rows a read threw away", async () => {
    const { analysis } = await analyze(
      `SELECT id FROM qp_post WHERE title = ${p(1)}`,
      ["Post 77"],
      {
        measure: true,
      },
    );
    expect(analysis.plan!.measured).toBe(true);
    expect(finding(analysis, "rows-thrown-away")!.message).toMatch(/19,?999 rows of qp_post/);
  });

  it.runIf(innodb)(
    "finds a filtered join that reads a whole table into a join buffer",
    async () => {
      const { analysis } = await analyze(
        `SELECT p.id FROM qp_author a JOIN qp_post p ON p.title = a.name WHERE a.email = ${p(1)}`,
        ["author5@example.test"],
      );
      expect(finding(analysis, "join-buffer")).toMatchObject({
        table: "qp_post",
        fix: { prisma: "@@index([title])" },
      });
    },
  );

  it.runIf(engine === "sqlite")("finds the index SQLite builds for a join every time", async () => {
    const { analysis } = await analyze(
      `SELECT a.id FROM qp_author a JOIN qp_post p ON p.title = a.name`,
    );
    expect(rules(analysis)).toContain("automatic-index");
  });

  it("tries the suggested index in a transaction it rolls back, where the engine can undo it", async () => {
    const { query, analysis } = await analyze(`SELECT id FROM qp_post WHERE title = ${p(1)}`, [
      "Post 77",
    ]);
    const database = findDatabase(query.database)!;
    const advice = finding(analysis, "full-scan-missing-index")!;
    const trial = await tryIndex(database, query, {
      table: { name: "qp_post" },
      columns: [{ name: "title" }],
      name: "qp_post_title_idx",
      prisma: advice.fix!.prisma!,
      sql: advice.fix!.sql!,
    });
    if (innodb) expect(trial).toMatchObject({ problem: "not_triable" });
    else {
      expect(trial).toMatchObject({ index: "qp_post_title_idx", used: true });
      if (engine === "postgres")
        expect((trial as { after: number }).after).toBeLessThan(
          (trial as { before: number }).before,
        );
      const { analysis: after } = await analyze(`SELECT id FROM qp_post WHERE title = ${p(1)}`, [
        "Post 77",
      ]);
      expect(rules(after)).toContain("full-scan-missing-index");
    }
  });
});
