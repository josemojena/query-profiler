import { step, type Access, type PlanStep } from "../plan.js";

// SCAN or SEARCH, the table (older versions say "TABLE t AS alias"), and how.
const READ = /^(SCAN|SEARCH) (?:TABLE )?(\S+)(?: AS (\S+))?(?: USING (.+))?$/;
// An automatic index has no name: what follows INDEX is its lookup.
const INDEX = /^(AUTOMATIC (?:PARTIAL )?)?(COVERING )?INDEX(?: ([^\s(]\S*))?(?: \((.*)\))?$/;
const PRIMARY_KEY = /^(INTEGER )?PRIMARY KEY(?: \((.*)\))?$/;
const TEMP_TREE = /^USE TEMP B-TREE FOR (.+)$/;

/** SQLite's `EXPLAIN QUERY PLAN` rows (id, parent, notused, detail), as steps. */
export function readSqlitePlan(rows: unknown[][]): PlanStep[] {
  const roots: PlanStep[] = [];
  const byId = new Map<number, PlanStep>();
  for (const [id, parent, , detail] of rows) {
    const current = detailStep(String(detail));
    (byId.get(Number(parent))?.children ?? roots).push(current);
    byId.set(Number(id), current);
  }
  return roots;
}

function detailStep(detail: string): PlanStep {
  const read = READ.exec(detail);
  if (read) {
    const [, verb, name, alias, using] = read;
    const how: How = using
      ? readUsing(verb!, using)
      : { access: verb === "SCAN" ? "full" : "index" };
    // A name Prisma qualified (main.Order) keeps the schema in the plan.
    return step({ label: detail, kind: "read", table: alias ?? name!.split(".").at(-1), ...how });
  }
  const temp = TEMP_TREE.exec(detail)?.[1];
  if (temp)
    return step({
      label: detail,
      kind: /ORDER BY/.test(temp) ? "sort" : "group",
      temporary: true,
    });
  return step({ label: detail, kind: "other" });
}

type How = Pick<PlanStep, "access" | "index" | "lookup" | "notes">;

function readUsing(verb: string, using: string): How {
  const index = INDEX.exec(using);
  if (index) {
    const [, automatic, covering, name, lookup] = index;
    const access: Access = automatic
      ? "automatic-index"
      : verb === "SCAN"
        ? "index-full"
        : covering
          ? "index-only"
          : "index";
    return { access, index: name, lookup };
  }
  const primary = PRIMARY_KEY.exec(using);
  if (primary) {
    const [, integer, lookup] = primary;
    const single = /^\w+=\?$/.test(lookup ?? "");
    return {
      access: verb === "SCAN" ? "full" : single ? "unique" : "index",
      index: integer ? "INTEGER PRIMARY KEY" : "PRIMARY KEY",
      lookup,
    };
  }
  return { access: verb === "SCAN" ? "full" : "index", notes: [using] };
}

/** The rows drawn as a tree, the way the sqlite3 shell prints them. */
export function sqlitePlanText(rows: unknown[][]): string {
  const children = new Map<number, unknown[][]>();
  for (const row of rows)
    children.set(Number(row[1]), [...(children.get(Number(row[1])) ?? []), row]);
  const draw = (parent: number, prefix: string): string[] =>
    (children.get(parent) ?? []).flatMap((row, index, siblings) => {
      const last = index === siblings.length - 1;
      return [
        `${prefix}${last ? "`--" : "|--"}${String(row[3])}`,
        ...draw(Number(row[0]), `${prefix}${last ? "   " : "|  "}`),
      ];
    });
  return ["QUERY PLAN", ...draw(0, "")].join("\n");
}
