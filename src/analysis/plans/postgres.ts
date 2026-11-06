import {
  allSteps,
  asNumber,
  asText,
  parseJson,
  step,
  type Access,
  type Measured,
  type Plan,
  type PlanStep,
} from "../plan.js";

type Node = Record<string, unknown> & { Plans?: Node[] };

const READS: Record<string, Access> = {
  "Seq Scan": "full",
  "Index Scan": "index",
  "Index Only Scan": "index-only",
  "Bitmap Heap Scan": "index",
  "Tid Scan": "unique",
  "Tid Range Scan": "index",
};
const JOINS = new Set(["Nested Loop", "Hash Join", "Merge Join"]);
const SORTS = new Set(["Sort", "Incremental Sort"]);
const GROUPS = new Set(["Aggregate", "Group", "Unique", "WindowAgg", "SetOp"]);

/** Where a measured query's time went: planning, running, and compiling it with JIT. */
export function readPostgresTiming(output: unknown): Plan["timing"] {
  const [first] = parseJson(output) as Record<string, unknown>[];
  if (!first || first["Execution Time"] === undefined) return undefined;
  const jit = first.JIT as { Timing?: { Total?: unknown } } | undefined;
  const timing = {
    planningMs: asNumber(first["Planning Time"]),
    executionMs: asNumber(first["Execution Time"]),
    jitMs: asNumber(jit?.Timing?.Total),
  };
  return Object.fromEntries(Object.entries(timing).filter(([, value]) => value !== undefined));
}

/** PostgreSQL's `EXPLAIN (FORMAT JSON)`, estimated or measured, as steps. */
export function readPostgresPlan(output: unknown): PlanStep[] {
  const [first] = parseJson(output) as { Plan: Node }[];
  return first ? [toStep(first.Plan)] : [];
}

function toStep(node: Node): PlanStep {
  const type = String(node["Node Type"]);
  const children = (node.Plans ?? []).map(toStep);
  const text = (key: string) => asText(node[key]);
  const common = {
    label: type,
    rows: asNumber(node["Plan Rows"]),
    cost: asNumber(node["Total Cost"]),
    measured: measure(node),
  };
  if (type in READS) {
    // A bitmap heap scan finds its rows through the bitmap index scans under it.
    const bitmap = allSteps(children).find((child) => child.index);
    return step(
      {
        ...common,
        kind: "read",
        table: text("Alias") ?? text("Relation Name"),
        relation: text("Relation Name"),
        // An index scan with no condition reads every entry, for their order.
        access:
          type.startsWith("Index") && node["Index Cond"] === undefined ? "index-full" : READS[type],
        index: text("Index Name") ?? bitmap?.index,
        lookup: text("Index Cond") ?? bitmap?.lookup,
        filter: text("Filter"),
      },
      children,
    );
  }
  if (type === "Bitmap Index Scan")
    return step(
      { ...common, kind: "other", index: text("Index Name"), lookup: text("Index Cond") },
      children,
    );
  if (JOINS.has(type))
    return step(
      {
        ...common,
        label: `${type}${text("Join Type") ? ` (${text("Join Type")})` : ""}`,
        kind: "join",
        lookup: text("Hash Cond") ?? text("Merge Cond"),
        filter: text("Join Filter"),
      },
      children,
    );
  if (SORTS.has(type))
    return step(
      {
        ...common,
        kind: "sort",
        keys: node["Sort Key"] as string[] | undefined,
        onDisk:
          node["Sort Space Type"] === "Disk" || /external/i.test(text("Sort Method") ?? "")
            ? true
            : undefined,
      },
      children,
    );
  if (GROUPS.has(type))
    return step(
      {
        ...common,
        label: text("Strategy") === "Hashed" ? "HashAggregate" : type,
        kind: "group",
        keys: node["Group Key"] as string[] | undefined,
        onDisk: (asNumber(node["HashAgg Batches"]) ?? 0) > 1 ? true : undefined,
        filter: text("Filter"),
      },
      children,
    );
  if (type === "Limit") return step({ ...common, kind: "limit" }, children);
  if (type === "Hash") {
    const batches = asNumber(node["Hash Batches"]);
    return step(
      { ...common, kind: "other", batches, onDisk: (batches ?? 0) > 1 ? true : undefined },
      children,
    );
  }
  if (type === "ModifyTable")
    return step(
      {
        ...common,
        label: text("Operation") ?? type,
        kind: "write",
        table: text("Alias") ?? text("Relation Name"),
        relation: text("Relation Name"),
      },
      children,
    );
  return step(
    {
      ...common,
      kind: "other",
      table: text("Alias"),
      relation: text("Relation Name"),
      filter: text("Filter"),
    },
    children,
  );
}

// PostgreSQL gives rows, time and rows removed as averages per loop.
function measure(node: Node): Measured | undefined {
  const loops = asNumber(node["Actual Loops"]);
  if (loops === undefined) return undefined;
  const perLoop = (key: string) => {
    const value = asNumber(node[key]);
    return value === undefined ? undefined : Math.round(value * loops * 100) / 100;
  };
  const ms = perLoop("Actual Total Time");
  const removed = perLoop("Rows Removed by Filter");
  // Heap Fetches, unlike rows and time, is already a total over every loop.
  const heapFetches = asNumber(node["Heap Fetches"]);
  return {
    rows: perLoop("Actual Rows") ?? 0,
    loops,
    ...(ms === undefined ? {} : { ms }),
    ...(removed === undefined ? {} : { removedByFilter: removed }),
    ...(heapFetches === undefined ? {} : { heapFetches }),
  };
}
