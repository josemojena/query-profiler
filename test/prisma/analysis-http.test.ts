import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Analysis, Finding, Trial } from "../../src/analysis/analyze.js";
import {
  ANALYSIS_HEADER,
  createHandler,
  endProfile,
  runWithProfile,
  startProfile,
  type Profile,
} from "../../src/core/index.js";
import { beginQuery } from "../../src/core/recorder.js";
import { profilePrisma } from "../../src/prisma/index.js";
import { analysisFixture, dropAnalysisFixture } from "./analysis-fixture.js";
import { ENGINES } from "./engines.js";

process.env.NODE_ENV = "development";
const handle = createHandler();
const api = (path: string, init: RequestInit & { asked?: boolean } = {}) => {
  const { asked = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (asked) headers.set(ANALYSIS_HEADER, "1");
  return handle(
    new Request(`http://localhost:4983/_profiler/api/profiles/${path}`, { ...rest, headers }),
  );
};

describe.each(ENGINES.filter(([engine]) => engine === "postgres" || engine === "sqlite"))(
  "the analysis API on %s",
  (engine, connect) => {
    const prisma = profilePrisma(connect());
    const p = (position: number) => (engine === "postgres" ? `$${position}` : "?");
    let profile: Profile;

    beforeAll(async () => {
      for (const sql of [...dropAnalysisFixture(), ...analysisFixture(engine)])
        await prisma.$executeRawUnsafe(sql);
      const active = startProfile(
        { method: "GET", url: "/posts", kind: "document" },
        { name: "test" },
      );
      await runWithProfile(active, async () => {
        await prisma.$queryRawUnsafe(`SELECT id FROM qp_post WHERE title = ${p(1)}`, "Post 7");
        await prisma.$queryRawUnsafe(`SELECT id FROM qp_author WHERE name LIKE ${p(1)}`, "%son");
      });
      profile = endProfile(active, { status: 200 });
    }, 60_000);
    afterAll(async () => {
      for (const sql of dropAnalysisFixture()) await prisma.$executeRawUnsafe(sql);
      await prisma.$disconnect();
    });

    const byTitle = () => profile.queries.at(-2)!.id;
    const byName = () => profile.queries.at(-1)!.id;

    it("lists what each query's SQL shows without asking the database", async () => {
      const response = await api(`${profile.token}/findings`, { asked: false });
      const findings = (await response.json()) as Record<string, Finding[]>;
      expect(findings[byName()]!.map((finding) => finding.rule)).toContain("leading-wildcard");
      expect(findings[byTitle()]).toEqual([]);
    });

    it("gives a query's plan, tables and findings", async () => {
      const analysis = (await (
        await api(`${profile.token}/queries/${byTitle()}/analysis`)
      ).json()) as Analysis;
      expect(analysis).toMatchObject({ engine, plan: { measured: false } });
      expect(analysis.tables.map((table) => table.name)).toEqual(["qp_post"]);
      expect(analysis.findings[0]).toMatchObject({
        rule: "full-scan-missing-index",
        fix: { index: "qp_post_title_idx" },
      });
    });

    it("tries the suggested index by its name, and only an index it suggested", async () => {
      const trial = await api(`${profile.token}/queries/${byTitle()}/trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: "qp_post_title_idx" }),
      });
      expect((await trial.json()) as Trial).toMatchObject({
        index: "qp_post_title_idx",
        used: true,
      });
      const other = await api(`${profile.token}/queries/${byTitle()}/trial`, {
        method: "POST",
        body: JSON.stringify({ index: "qp_post_views_a" }),
      });
      expect(other.status).toBe(404);
    });

    it("adds the stored requests up, asking the database only with the header", async () => {
      const route = (asked: boolean) => {
        const headers = new Headers(asked ? { [ANALYSIS_HEADER]: "1" } : {});
        return handle(
          new Request("http://localhost:4983/_profiler/api/stats/analysis", { headers }),
        );
      };
      expect((await route(false)).status).toBe(403);
      const session = (await (await route(true)).json()) as {
        shapes: number;
        indexes: { name: string }[];
      };
      expect(session.shapes).toBeGreaterThanOrEqual(2);
      expect(session.indexes.map((pick) => pick.name)).toContain("qp_post_title_idx");
    });

    it("asks the database only with its own header, which a page on another origin cannot send unasked", async () => {
      expect(
        (await api(`${profile.token}/queries/${byTitle()}/analysis`, { asked: false })).status,
      ).toBe(403);
      expect(
        (await api(`${profile.token}/queries/${byTitle()}/trial`, { method: "POST", asked: false }))
          .status,
      ).toBe(403);
    });

    it("says why when a query has no connection to ask, or the database refuses", async () => {
      const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
      const orphan = beginQuery(active, { sql: "SELECT 1" })!;
      const broken = beginQuery(active, {
        sql: "SELECT nope FROM qp_post",
        database: profile.queries[0]!.database,
      })!;
      const other = endProfile(active, { status: 200 });
      const missing = await api(`${other.token}/queries/${orphan.id}/analysis`);
      expect([missing.status, ((await missing.json()) as { error: string }).error]).toEqual([
        409,
        "no_database",
      ]);
      const refused = await api(`${other.token}/queries/${broken.id}/analysis`);
      expect(refused.status).toBe(422);
      expect(((await refused.json()) as { message: string }).message).toMatch(/nope/);
      expect((await api(`ffffff/queries/q_1/analysis`)).status).toBe(404);
    });
  },
);
