import type { Engine } from "../../src/analysis/plan.js";

/** The analysis fixture's tables, children first, the order to drop them in. */
export const ANALYSIS_TABLES = ["qp_post", "qp_fresh", "qp_author"];

export const AUTHORS = 1000;
export const POSTS = 20000;

// Numbers 1 to 99999 without recursion, which MySQL caps at 1000 levels by default.
const DIGITS =
  "(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
const NUMBERS = `(SELECT a.d + 10 * b.d + 100 * c.d + 1000 * e.d + 10000 * f.d AS n FROM ${DIGITS} a, ${DIGITS} b, ${DIGITS} c, ${DIGITS} e, ${DIGITS} f)`;

/**
 * Tables built to have the problems the rules look for, with enough rows that each database plans
 * as it would in production: a foreign key with no index (InnoDB adds one by itself), a redundant
 * and a duplicate index, text to search, columns to sort and group by, and a table never analyzed.
 */
export function analysisFixture(engine: Engine): string[] {
  const text = engine === "mysql" || engine === "mariadb" ? "VARCHAR(191)" : "TEXT";
  const time = engine === "postgres" ? "TIMESTAMP" : engine === "sqlite" ? "TEXT" : "DATETIME";
  const tables = [
    `CREATE TABLE qp_author (id INTEGER PRIMARY KEY, name ${text} NOT NULL, email ${text} NOT NULL, country ${text} NOT NULL)`,
    `CREATE TABLE qp_post (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES qp_author (id), title ${text} NOT NULL, status ${text} NOT NULL, created_at ${time} NOT NULL, views INTEGER NOT NULL)`,
    `CREATE TABLE qp_fresh (id INTEGER PRIMARY KEY, kind ${text} NOT NULL)`,
    "CREATE INDEX qp_post_status_idx ON qp_post (status)",
    "CREATE INDEX qp_post_status_created_idx ON qp_post (status, created_at)",
    "CREATE INDEX qp_post_views_a ON qp_post (views)",
    "CREATE INDEX qp_post_views_b ON qp_post (views)",
  ];
  // A partial index, which MySQL and MariaDB do not have.
  if (engine === "postgres" || engine === "sqlite")
    tables.push(
      "CREATE INDEX qp_post_published_idx ON qp_post (created_at) WHERE status = 'published'",
    );
  if (engine === "mysql" || engine === "mariadb")
    // A FOREIGN KEY clause, since InnoDB ignores REFERENCES written on the column.
    tables[1] = tables[1]!.replace(
      "author_id INTEGER NOT NULL REFERENCES qp_author (id)",
      "author_id INTEGER NOT NULL, FOREIGN KEY (author_id) REFERENCES qp_author (id)",
    );
  return [...tables, ...rows(engine), ...statistics(engine)];
}

function rows(engine: Engine): string[] {
  const country = (n: string) =>
    `CASE ${n} % 4 WHEN 0 THEN 'es' WHEN 1 THEN 'fr' WHEN 2 THEN 'de' ELSE 'it' END`;
  const status = (n: string) =>
    `CASE ${n} % 3 WHEN 0 THEN 'draft' WHEN 1 THEN 'published' ELSE 'archived' END`;
  if (engine === "postgres")
    return [
      `INSERT INTO qp_author SELECT n, 'Author ' || n, 'author' || n || '@example.test', ${country("n")} FROM generate_series(1, ${AUTHORS}) n`,
      `INSERT INTO qp_post SELECT n, 1 + n % ${AUTHORS}, 'Post ' || n, ${status("n")}, TIMESTAMP '2026-01-01' + n * INTERVAL '1 minute', n % 500 FROM generate_series(1, ${POSTS}) n`,
      `INSERT INTO qp_fresh SELECT n, 'kind ' || (n % 7) FROM generate_series(1, ${POSTS}) n`,
    ];
  if (engine === "sqlite") {
    const series = (count: number) =>
      `WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${count})`;
    return [
      `${series(AUTHORS)} INSERT INTO qp_author SELECT n, 'Author ' || n, 'author' || n || '@example.test', ${country("n")} FROM s`,
      `${series(POSTS)} INSERT INTO qp_post SELECT n, 1 + n % ${AUTHORS}, 'Post ' || n, ${status("n")}, datetime('2026-01-01', '+' || n || ' minutes'), n % 500 FROM s`,
      `${series(POSTS)} INSERT INTO qp_fresh SELECT n, 'kind ' || (n % 7) FROM s`,
    ];
  }
  const numbers = (count: number) => `${NUMBERS} numbers WHERE n BETWEEN 1 AND ${count}`;
  return [
    `INSERT INTO qp_author SELECT n, CONCAT('Author ', n), CONCAT('author', n, '@example.test'), ${country("n")} FROM ${numbers(AUTHORS)}`,
    `INSERT INTO qp_post SELECT n, 1 + n % ${AUTHORS}, CONCAT('Post ', n), ${status("n")}, TIMESTAMP '2026-01-01 00:00:00' + INTERVAL n MINUTE, n % 500 FROM ${numbers(POSTS)}`,
    `INSERT INTO qp_fresh SELECT n, CONCAT('kind ', n % 7) FROM ${numbers(POSTS)}`,
  ];
}

// Fresh statistics on every table but qp_fresh, and no autovacuum to change them during a run.
function statistics(engine: Engine): string[] {
  if (engine === "postgres")
    return [
      ...ANALYSIS_TABLES.map((table) => `ALTER TABLE ${table} SET (autovacuum_enabled = false)`),
      "ANALYZE qp_author",
      "ANALYZE qp_post",
    ];
  if (engine === "sqlite") return ["ANALYZE qp_author", "ANALYZE qp_post"];
  return ["ANALYZE TABLE qp_author, qp_post"];
}

export const dropAnalysisFixture = () =>
  ANALYSIS_TABLES.map((table) => `DROP TABLE IF EXISTS ${table}`);
