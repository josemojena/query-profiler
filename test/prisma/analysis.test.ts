import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeQuery, tryIndex, type Analysis } from "../../src/analysis/analyze.js";
import { prismaNames, readSchema } from "../../src/analysis/schema.js";
import { analyzeSession } from "../../src/analysis/session.js";
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

  it("writes the index with the schema's names, for a model and a field mapped to other ones", async () => {
    const names = prismaNames(
      readSchema(
        `model Post {\n  id Int @id\n  headline String @map("title")\n  @@map("qp_post")\n}`,
      ),
    );
    const { analysis } = await analyze(
      `SELECT id FROM qp_post WHERE title = ${p(1)}`,
      ["Post 77"],
      {
        names,
      },
    );
    expect(finding(analysis, "full-scan-missing-index")!.fix).toMatchObject({
      text: "Add an index on headline to the Post model, then run prisma migrate dev.",
      prisma: "@@index([headline])",
      sql: expect.stringMatching(/\btitle\b/),
    });
  });

  it("counts each table's rows, exactly, whatever the engine caches", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_post WHERE id = ${p(1)}`, [77]);
    expect(analysis.tables.find((table) => table.name === "qp_post")!.rows).toBe(20000);
  });

  it("finds nothing wrong in reading an index in order up to a LIMIT", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_post ORDER BY views LIMIT 5`);
    expect(analysis.findings.filter((each) => each.about === "query")).toEqual([]);
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

  it("advises for a LIKE with a fixed start an index the engine can read it with", async () => {
    const { query, analysis } = await analyze(`SELECT id FROM qp_tag WHERE slug LIKE ${p(1)}`, [
      "tag-1234%",
    ]);
    // A PostgreSQL B-tree finds a fixed start only in byte order, and SQLite's LIKE ignores case.
    const expected = {
      postgres: [
        "full-scan-needs-pattern-ops",
        'CREATE INDEX "qp_tag_slug_pattern_idx" ON "public"."qp_tag" ("slug" varchar_pattern_ops);',
      ],
      sqlite: [
        "like-needs-nocase-index",
        'CREATE INDEX "qp_tag_slug_nocase_idx" ON "qp_tag" ("slug" COLLATE NOCASE);',
      ],
      mysql: ["full-scan-missing-index", "CREATE INDEX `qp_tag_slug_idx` ON `qp_tag` (`slug`);"],
      mariadb: ["full-scan-missing-index", "CREATE INDEX `qp_tag_slug_idx` ON `qp_tag` (`slug`);"],
    }[engine];
    expect(
      analysis.findings.filter((each) => each.about === "query").map(({ rule }) => rule),
    ).toEqual([expected[0]]);
    const advice = finding(analysis, expected[0]!)!;
    expect(advice.fix!.sql).toBe(expected[1]);
    if (!innodb) {
      const trial = await tryIndex(findDatabase(query.database)!, query, {
        name: advice.fix!.index!,
        sql: advice.fix!.sql!,
      });
      expect(trial).toMatchObject({ used: true });
    }
  });

  it.runIf(engine === "postgres")(
    "tells a LIKE with a fixed start that its index sorts by a language's rules, and leaves alone an index that serves it",
    async () => {
      const { analysis: plain } = await analyze(`SELECT id FROM qp_tag WHERE name LIKE $1`, [
        "Tag 1234%",
      ]);
      expect(finding(plain, "prefix-needs-pattern-ops")).toMatchObject({
        message: expect.stringContaining("qp_tag_name_idx"),
        fix: {
          sql: 'CREATE INDEX "qp_tag_name_pattern_idx" ON "public"."qp_tag" ("name" text_pattern_ops);',
        },
      });
      expect(
        plain.findings.filter((each) => each.about === "query").map(({ rule }) => rule),
      ).toEqual(["prefix-needs-pattern-ops"]);
      const { analysis: pattern } = await analyze(`SELECT id FROM qp_tag WHERE code LIKE $1`, [
        "code-1234%",
      ]);
      expect(pattern.plan!.raw).toContain("qp_tag_code_idx");
      expect(pattern.findings.filter((each) => each.about === "query")).toEqual([]);
      const { analysis: bytes } = await analyze(`SELECT id FROM qp_tag WHERE label LIKE $1`, [
        "Tag 12%",
      ]);
      expect(finding(bytes, "full-scan-missing-index")!.fix!.prisma).toBe("@@index([label])");
      expect(rules(bytes)).not.toContain("full-scan-needs-pattern-ops");
    },
  );

  it.runIf(engine === "sqlite")(
    "asks for an index built with COLLATE NOCASE for LIKE, and is content with one",
    async () => {
      const { analysis: binary } = await analyze(`SELECT id FROM qp_tag WHERE name LIKE ?`, [
        "Tag 1234%",
      ]);
      expect(finding(binary, "like-needs-nocase-index")!.fix!.sql).toBe(
        'CREATE INDEX "qp_tag_name_nocase_idx" ON "qp_tag" ("name" COLLATE NOCASE);',
      );
      // SQLite reads the whole index, which holds every name, rather than the table.
      expect(
        binary.findings.filter((each) => each.about === "query").map(({ rule }) => rule),
      ).toEqual(["like-needs-nocase-index"]);
      const { analysis: nocase } = await analyze(`SELECT id FROM qp_tag WHERE code LIKE ?`, [
        "code-1234%",
      ]);
      expect(nocase.plan!.raw).toContain("qp_tag_code_idx");
      expect(nocase.findings.filter((each) => each.about === "query")).toEqual([]);
      const [tag] = nocase.tables;
      expect(tag!.indexes.find((index) => index.name === "qp_tag_code_idx")!.collations).toEqual([
        { name: "NOCASE" },
      ]);
    },
  );

  it.runIf(innodb)(
    "tells an index the optimizer may not use, and a read it would serve, instead of asking for another",
    async () => {
      const [serves, hidden] =
        engine === "mysql"
          ? ["invisible-index-would-serve", "invisible-index"]
          : ["ignored-index-would-serve", "ignored-index"];
      const { analysis } = await analyze(`SELECT id FROM qp_tag WHERE name = ?`, ["Tag 12"]);
      expect(finding(analysis, serves)!.message).toContain("qp_tag_name_idx");
      expect(rules(analysis)).not.toContain("full-scan-missing-index");
      const notes = analysis.findings.filter((each) => each.rule === hidden);
      const about = (index: string) => notes.find((note) => note.message.includes(index))!;
      expect(about("qp_tag_name_idx").fix!.kind).toBe("drop-index");
      // A unique index still keeps duplicates out, so dropping it is not offered.
      expect(about("qp_tag_code_idx").fix).toBeUndefined();
      const { analysis: unindexed } = await analyze(`SELECT id FROM qp_tag WHERE slug = ?`, [
        "tag-12",
      ]);
      expect(rules(unindexed)).toContain("full-scan-missing-index");
      expect(rules(unindexed)).not.toContain(serves);
    },
  );

  it("finds a function on a filtered column, with the expression index to add", async () => {
    const { analysis } = await analyze(`SELECT id FROM qp_author WHERE lower(email) = ${p(1)}`, [
      "a",
    ]);
    const wrapped = finding(analysis, "function-on-column")!;
    expect(wrapped.message).toContain("lower()");
    if (engine === "mariadb") expect(wrapped.fix!.text).toContain("generated column");
    else expect(wrapped.fix!.sql).toMatch(/\(\(lower\(["`]?email["`]?\)\)\);$/);
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
      // SQLite gathers statistics with PRAGMA optimize, which leaves tables it deems fine alone.
      expect(finding(analysis, "never-analyzed")!.fix!.sql).toMatch(
        engine === "sqlite" ? /^PRAGMA optimize;$/ : /^ANALYZE (?:"public"\.)?["`]qp_fresh["`];$/,
      );
      const { analysis: analyzed } = await analyze(
        `SELECT id FROM qp_post WHERE id = ${p(1)}`,
        [1],
      );
      expect(rules(analyzed)).not.toContain("never-analyzed");
    },
  );

  it.runIf(engine === "postgres")(
    "finds what PostgreSQL's manual warns of: an index searched past its first column, counting a whole table, paging with no order",
    async () => {
      const { analysis: buried } = await analyze(
        `SELECT id FROM qp_post WHERE created_at > ${p(1)}`,
        ["2026-01-10"],
      );
      expect(finding(buried, "buried-column")!.message).toContain("qp_post_status_created_idx");
      expect(rules(buried)).not.toContain("full-scan-missing-index");
      const { analysis: count } = await analyze(`SELECT COUNT(*) FROM qp_post`);
      expect(finding(count, "count-every-row")!.message).toContain("20,000 rows of qp_post");
      const { analysis: page } = await analyze(`SELECT id FROM qp_post LIMIT 10 OFFSET 20`);
      expect(rules(page)).toContain("paging-without-order");
    },
  );

  it.runIf(engine === "postgres")(
    "finds a NOT IN with a NULL, a pattern too short for trigrams, and a parameter against a partial index",
    async () => {
      const { analysis: nulls } = await analyze(
        `SELECT id FROM qp_author WHERE id NOT IN (${p(1)}, NULL)`,
        [1],
      );
      expect(rules(nulls)).toContain("not-in-null");
      const { analysis: short } = await analyze(
        `SELECT id FROM qp_author WHERE name ILIKE ('%' || ${p(1)} || '%')`,
        ["ab"],
      );
      expect(rules(short)).toEqual(expect.arrayContaining(["short-pattern"]));
      expect(rules(short)).not.toContain("insensitive-match");
      const { analysis: partial } = await analyze(
        `SELECT id FROM qp_post WHERE status = ${p(1)} AND created_at > ${p(2)}`,
        ["published", "2026-01-10"],
      );
      expect(finding(partial, "partial-index-parameter")!.message).toContain(
        "qp_post_published_idx",
      );
    },
  );

  it("finds pages ordered by a column several rows share, which can repeat or miss rows", async () => {
    const { analysis: shared } = await analyze(
      `SELECT id FROM qp_post ORDER BY views LIMIT 10 OFFSET 20`,
    );
    expect(finding(shared, "unstable-order")!.message).toContain("ordered by views");
    const { analysis: unique } = await analyze(
      `SELECT id FROM qp_post ORDER BY views, id LIMIT 10 OFFSET 20`,
    );
    expect(rules(unique)).not.toContain("unstable-order");
  });

  it.runIf(innodb)(
    "finds a text column compared with a number, and a condition no row can match",
    async () => {
      const { analysis: numeric } = await analyze(
        `SELECT id FROM qp_post WHERE title = ${p(1)}`,
        [42],
      );
      expect(rules(numeric)).toContain("number-on-string");
      const { analysis: text } = await analyze(`SELECT id FROM qp_post WHERE title = ${p(1)}`, [
        "42",
      ]);
      expect(rules(text)).not.toContain("number-on-string");
      const { analysis: never } = await analyze(`SELECT id FROM qp_post WHERE 1 = 0`);
      expect(finding(never, "impossible-condition")!.message).toMatch(/^Impossible WHERE/);
    },
  );

  it("adds the session up: one index that serves several shapes, ranked by the time at stake", async () => {
    const active = startProfile(
      { method: "GET", url: "/posts", kind: "document" },
      { name: "test" },
    );
    await runWithProfile(active, async () => {
      for (const title of ["Post 1", "Post 2", "Post 3"])
        await prisma.$queryRawUnsafe(`SELECT id FROM qp_post WHERE title = ${p(1)}`, title);
      await prisma.$queryRawUnsafe(
        `SELECT id FROM qp_post WHERE title = ${p(1)} AND views > ${p(2)}`,
        "Post 4",
        10,
      );
    });
    const session = await analyzeSession([endProfile(active, { status: 200 })], (query) =>
      findDatabase(query.database),
    );
    expect(session).toMatchObject({ shapes: 2, analyzed: 2, skipped: 0 });
    const onTitle = session.indexes.find((pick) => pick.table === "qp_post")!;
    expect(onTitle).toMatchObject({
      columns: ["title", "views"],
      covers: ["qp_post_title_idx"],
      runs: 4,
    });
    expect(session.tables.find((use) => use.table === "qp_post")).toMatchObject({
      shapes: 2,
      runs: 4,
      fullReads: 2,
    });
  });

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
      // MariaDB's own rule says how its block join reads the table again for every bufferful.
      expect(
        finding(analysis, engine === "mariadb" ? "join-buffer-scan" : "join-buffer"),
      ).toMatchObject({
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

  it.runIf(engine === "mysql" || engine === "sqlite")(
    "finds a correlated subquery that reads a whole table again for each outer row, and the index that makes each run a lookup",
    async () => {
      const { analysis } = await analyze(
        `SELECT a.id, (SELECT COUNT(*) FROM qp_post p WHERE p.title = a.name) AS c FROM qp_author a`,
      );
      const rule = engine === "mysql" ? "dependent-subquery-scan" : "correlated-scan";
      expect(finding(analysis, rule)).toMatchObject({
        severity: "problem",
        table: "qp_post",
        fix: { prisma: "@@index([title])" },
      });
      // One finding for the read, not another that takes it for a read of its own.
      expect(
        analysis.findings
          .filter((each) => each.about === "query" && each.table === "qp_post")
          .map(({ rule }) => rule),
      ).toEqual([rule]);
    },
  );

  it.runIf(engine === "mysql")(
    "counts the runs of a correlated subquery that looks its rows up through an index",
    async () => {
      const sql = `SELECT a.id, (SELECT COUNT(*) FROM qp_post p WHERE p.author_id = a.id) AS c FROM qp_author a`;
      const { analysis } = await analyze(sql, [], { measure: true });
      expect(finding(analysis, "dependent-subquery-loops")).toMatchObject({
        table: "qp_post",
        message: expect.stringContaining("1,000 times"),
      });
      const { analysis: estimated } = await analyze(sql);
      expect(
        estimated.findings.filter((each) => each.about === "query" && each.table === "qp_post"),
      ).toEqual([]);
    },
  );

  it("tries the suggested index in a transaction it rolls back, where the engine can undo it", async () => {
    const { query, analysis } = await analyze(`SELECT id FROM qp_post WHERE title = ${p(1)}`, [
      "Post 77",
    ]);
    const database = findDatabase(query.database)!;
    const advice = finding(analysis, "full-scan-missing-index")!;
    const trial = await tryIndex(database, query, {
      name: advice.fix!.index!,
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
