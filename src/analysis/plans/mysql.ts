import {
  asNumber,
  asText,
  parseJson,
  step,
  type Access,
  type PlanStep,
  type StepKind,
} from "../plan.js";

type Json = Record<string, unknown>;

const ACCESS: Record<string, Access> = {
  ALL: "full",
  index: "index-full",
  range: "index",
  ref: "index",
  ref_or_null: "index",
  index_merge: "index",
  fulltext: "index",
  index_subquery: "index",
  eq_ref: "unique",
  const: "unique",
  system: "unique",
  unique_subquery: "unique",
};

/**
 * MySQL's `EXPLAIN FORMAT=JSON`, as steps: format version 1 (query_block), the default up to 9.4,
 * or version 2 (a tree of iterators), the default from 9.5. Told apart by shape, since a server can
 * set either.
 */
export function readMysqlPlan(output: unknown): PlanStep[] {
  const parsed = parseJson(output) as Json;
  if (parsed.query_block) return block(parsed.query_block as Json);
  // From 9.2 the root iterator sits under query_plan; before, its fields are the root's own.
  const root = (parsed.query_plan as Json | undefined) ?? parsed;
  return root.operation ? [mergeFilters(iterator(root))] : [];
}

// A version 2 iterator: its operation is the line EXPLAIN ANALYZE's tree prints, its inputs its
// children, and its estimates are per loop.
function iterator(node: Json): PlanStep {
  const operation = String(node.operation ?? "");
  const children = ((node.inputs as Json[] | undefined) ?? []).map(iterator);
  const estimates = {
    rows: asNumber(node.estimated_rows),
    cost: asNumber(node.estimated_total_cost),
    measured: iteratorMeasured(node),
  };
  switch (node.access_type) {
    case "table":
    case "index":
      return step(
        {
          ...estimates,
          label: operation,
          kind: "read",
          table: asText(node.alias) ?? asText(node.table_name),
          relation: asText(node.table_name),
          access: iteratorAccess(node, operation),
          index: asText(node.index_name),
          lookup:
            asText(node.lookup_condition) ?? (node.ranges as string[] | undefined)?.join(" OR "),
          // The table a hash join reads into its hash says so in its heading.
          notes: [
            node.heading === "Hash" && "Using join buffer (hash join)",
            node.multi_range_read === true && "Using MRR",
          ].filter((note): note is string => typeof note === "string"),
        },
        children,
      );
    case "filter":
      return step(
        { ...estimates, label: "Filter", kind: "other", filter: asText(node.condition) },
        children,
      );
    case "join":
      return step(
        {
          ...estimates,
          label: operation,
          kind: "join",
          lookup: (node.hash_condition as string[] | undefined)?.join(" AND "),
        },
        children,
      );
    case "sort":
      return step(
        {
          ...estimates,
          label: "Sort",
          kind: "sort",
          keys: node.sort_fields as string[] | undefined,
        },
        children,
      );
    case "limit":
      return step({ ...estimates, label: operation, kind: "limit" }, children);
    default:
      return { ...treeStep(operation), ...defined(estimates), children };
  }
}

function iteratorAccess(node: Json, operation: string): Access {
  if (node.access_type === "table") return "full";
  const covering = node.covering === true;
  if (/^(?:covering )?index scan on/i.test(operation)) return "index-full";
  if (node.index_access_type === "index_lookup" && /^single-row/i.test(operation)) return "unique";
  return covering ? "index-only" : "index";
}

function iteratorMeasured(node: Json): PlanStep["measured"] {
  const loops = asNumber(node.actual_loops);
  if (loops === undefined) return undefined;
  const rows = asNumber(node.actual_rows) ?? 0;
  const last = asNumber(node.actual_last_row_ms);
  return {
    rows: Math.round(rows * loops * 100) / 100,
    loops,
    ...(last === undefined ? {} : { ms: Math.round(last * loops * 1000) / 1000 }),
  };
}

const defined = <T extends object>(fields: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

// Where a query block keeps its subqueries, and where MySQL's tree says each one runs.
const SUBQUERIES: [string, string][] = [
  ["select_list_subqueries", "projection"],
  ["order_by_subqueries", "projection"],
  ["group_by_subqueries", "projection"],
  ["having_subqueries", "condition"],
];

function block(node: Json | undefined): PlanStep[] {
  if (!node) return [];
  const nested = SUBQUERIES.flatMap(([key, place]) =>
    ((node[key] as Json[] | undefined) ?? []).map((each) => subquery(each, place)),
  );
  return [...blockSteps(node), ...nested];
}

/**
 * A subquery as the step EXPLAIN ANALYZE's tree prints for it: "Select #2 (subquery in
 * condition; dependent)", run again for each outer row, uncacheable, or run only once.
 */
function subquery(node: Json, place: string): PlanStep {
  const inner = node.query_block as Json | undefined;
  const runs =
    node.dependent === true
      ? "dependent"
      : node.cacheable === false
        ? "uncacheable"
        : "run only once";
  return step(
    {
      label: `Select #${String(inner?.select_id ?? "?")} (subquery in ${place}; ${runs})`,
      kind: "other",
    },
    block(node),
  );
}

function blockSteps(node: Json): PlanStep[] {
  if (typeof node.message === "string") return [step({ label: node.message, kind: "other" })];
  if (node.query_block) return block(node.query_block as Json);
  if (node.table) return [table(node.table as Json)];
  if (Array.isArray(node.nested_loop)) {
    const tables = (node.nested_loop as Json[]).flatMap(block);
    return tables.length > 1 ? [step({ label: "Nested loop", kind: "join" }, tables)] : tables;
  }
  const ordering = node.ordering_operation as Json | undefined;
  if (ordering) return operation(ordering, "sort", "Sort");
  const grouping = node.grouping_operation as Json | undefined;
  if (grouping) return operation(grouping, "group", "Group");
  const distinct = node.duplicates_removal as Json | undefined;
  if (distinct) return operation(distinct, "group", "Distinct");
  const union = node.union_result as Json | undefined;
  if (union)
    return [
      step(
        {
          label: "Union",
          kind: "other",
          temporary: union.using_temporary_table === true || undefined,
        },
        ((union.query_specifications as Json[] | undefined) ?? []).flatMap(block),
      ),
    ];
  const windowing = node.windowing as Json | undefined;
  if (windowing) return [step({ label: "Window", kind: "group" }, block(windowing))];
  const buffered = node.buffer_result as Json | undefined;
  return buffered ? block(buffered) : [];
}

// An ordering or grouping step shows only when MySQL sorts or uses a temporary table: otherwise an
// index gives the rows in order already.
function operation(node: Json, kind: StepKind, label: string): PlanStep[] {
  const inner = block(node);
  const filesort = node.using_filesort === true;
  const temporary = node.using_temporary_table === true;
  if (!filesort && !temporary) return inner;
  return [
    step(
      {
        label: [label, filesort && "using filesort", temporary && "using temporary"]
          .filter(Boolean)
          .join(", "),
        kind,
        temporary: temporary || undefined,
      },
      inner,
    ),
  ];
}

function table(node: Json): PlanStep {
  const accessType = String(node.access_type ?? "");
  const covering = node.using_index === true;
  const access = ACCESS[accessType];
  const cost = node.cost_info as Json | undefined;
  const subqueries = [
    ...block(node.materialized_from_subquery as Json | undefined),
    ...((node.attached_subqueries as Json[] | undefined) ?? []).map((each) =>
      subquery(each, "condition"),
    ),
  ];
  return step(
    {
      label: accessType || "table",
      kind: "read",
      table: asText(node.table_name),
      access: access === "index" && covering ? "index-only" : access,
      index: asText(node.key),
      // A full index scan lists the index's columns too, though it looks nothing up.
      lookup:
        access === "index-full" || access === "full"
          ? undefined
          : (node.used_key_parts as string[] | undefined)?.join(", "),
      filter: asText(node.attached_condition),
      possibleIndexes: node.possible_keys as string[] | undefined,
      rows: asNumber(node.rows_produced_per_join),
      rowsRead: asNumber(node.rows_examined_per_scan),
      cost: asNumber(cost?.prefix_cost),
      notes: [
        asText(node.using_join_buffer) && `Using join buffer (${String(node.using_join_buffer)})`,
        asText(node.index_condition) && "Using index condition",
        node.using_MRR === true && "Using MRR",
      ].filter((note): note is string => typeof note === "string"),
    },
    subqueries,
  );
}

// The step, its estimate (cost and rows per loop), and what running it measured.
const TREE_LINE =
  /^(\s*)-> (.*?)(?:\s+\(cost=[\d.e+-]+(?:\.\.[\d.e+-]+)? rows=([\d.e+-]+)\))?(?:\s+\(actual time=([\d.e+-]+)\.\.([\d.e+-]+) rows=([\d.e+-]+) loops=(\d+)\)|\s+\(never executed\))?\s*$/;

/** MySQL's `EXPLAIN ANALYZE`: the query run and measured, as a tree of text lines. */
export function readMysqlTree(text: string): PlanStep[] {
  const roots: PlanStep[] = [];
  const parents: { depth: number; step: PlanStep }[] = [];
  for (const line of text.split("\n")) {
    const match = TREE_LINE.exec(line);
    if (!match) continue;
    const [, indent, label, estimate, , end, rows, loops] = match;
    const depth = indent!.length;
    const current = treeStep(label!);
    if (estimate !== undefined) current.rows = Number(estimate);
    if (loops !== undefined) {
      const times = Number(loops);
      current.measured = {
        rows: Math.round(Number(rows) * times * 100) / 100,
        loops: times,
        ms: Math.round(Number(end) * times * 1000) / 1000,
      };
    }
    while (parents.length && parents.at(-1)!.depth >= depth) parents.pop();
    (parents.at(-1)?.step.children ?? roots).push(current);
    parents.push({ depth, step: current });
  }
  return roots.map(mergeFilters).map((root) => hashed(root, false));
}

// A hash join reads the table under its Hash step in full, into the join buffer.
function hashed(current: PlanStep, inHash: boolean): PlanStep {
  const inside = inHash || current.label === "Hash";
  const children = current.children.map((child) => hashed(child, inside));
  if (!inside || current.kind !== "read") return { ...current, children };
  return {
    ...current,
    notes: [...(current.notes ?? []), "Using join buffer (hash join)"],
    children,
  };
}

// A lookup or a range: the table, the index, what it reads by, and what Index Condition Pushdown
// checks on the entries it reads.
const READ_LINES: [RegExp, Access][] = [
  [/^Table scan on (\S+)/, "full"],
  [/^(?:Covering )?[Ii]ndex scan on (\S+) using (\S+)/, "index-full"],
  [
    /^Single-row (?:covering )?index lookup on (\S+) using (\S+) \((.*?)\)(?:, with index condition: (.*))?$/,
    "unique",
  ],
  [
    /^Covering index (?:lookup|range scan) on (\S+) using (\S+) (?:over )?\((.*?)\)(?:, with index condition: (.*))?$/,
    "index-only",
  ],
  [
    /^Index (?:lookup|range scan) on (\S+) using (\S+) (?:over )?\((.*?)\)(?:, with index condition: (.*))?$/,
    "index",
  ],
  [/^Constant row from (\S+)/, "unique"],
];

function treeStep(label: string): PlanStep {
  for (const [pattern, access] of READ_LINES) {
    const match = pattern.exec(label);
    if (match)
      return step({
        label,
        kind: "read",
        table: match[1],
        access,
        index: match[2],
        lookup: match[3],
        notes: match[4] === undefined ? undefined : ["Using index condition"],
      });
  }
  const filter = /^Filter: (.*)$/.exec(label)?.[1];
  if (filter) return step({ label: "Filter", kind: "other", filter });
  const sort = /^Sort(?: row IDs)?: (.*?)(?:, limit input to .*)?$/.exec(label)?.[1];
  if (sort) return step({ label: "Sort", kind: "sort", keys: sort.split(/, (?![^(]*\))/) });
  if (/join/i.test(label)) return step({ label, kind: "join" });
  if (/^Limit/.test(label)) return step({ label, kind: "limit" });
  if (/aggregate|deduplication/i.test(label))
    return step({ label, kind: "group", temporary: /temporary/i.test(label) || undefined });
  return step({ label, kind: "other", temporary: /temporary/i.test(label) || undefined });
}

// A filter over one read checks each row that read returns: it belongs to the read.
function mergeFilters(current: PlanStep): PlanStep {
  const children = current.children.map(mergeFilters);
  const [only] = children;
  if (current.label !== "Filter" || children.length !== 1 || only!.kind !== "read")
    return { ...current, children };
  const read = only!;
  const kept = current.measured?.rows;
  const measured = read.measured && {
    ...read.measured,
    rows: kept ?? read.measured.rows,
    removedByFilter: Math.max(0, read.measured.rows - (kept ?? read.measured.rows)),
  };
  // The filter's estimate is the rows kept; the read's own, the rows it reads.
  const estimates =
    current.rows === undefined ? {} : { rows: current.rows, rowsRead: read.rows ?? current.rows };
  return { ...read, filter: current.filter, ...estimates, ...(measured ? { measured } : {}) };
}
