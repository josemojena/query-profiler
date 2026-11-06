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

/** MySQL's `EXPLAIN FORMAT=JSON` (format version 1, the default), as steps. */
export function readMysqlPlan(output: unknown): PlanStep[] {
  const parsed = parseJson(output) as Json;
  return block(parsed.query_block as Json | undefined);
}

function block(node: Json | undefined): PlanStep[] {
  if (!node) return [];
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
    ...((node.attached_subqueries as Json[] | undefined) ?? []).flatMap(block),
  ];
  return step(
    {
      label: accessType || "table",
      kind: "read",
      table: asText(node.table_name),
      access: access === "index" && covering ? "index-only" : access,
      index: asText(node.key),
      lookup: (node.used_key_parts as string[] | undefined)?.join(", "),
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

const TREE_LINE =
  /^(\s*)-> (.*?)(?:\s+\(cost=[^)]*\))?(?:\s+\(actual time=([\d.e+-]+)\.\.([\d.e+-]+) rows=([\d.e+-]+) loops=(\d+)\)|\s+\(never executed\))?\s*$/;

/** MySQL's `EXPLAIN ANALYZE`: the query run and measured, as a tree of text lines. */
export function readMysqlTree(text: string): PlanStep[] {
  const roots: PlanStep[] = [];
  const parents: { depth: number; step: PlanStep }[] = [];
  for (const line of text.split("\n")) {
    const match = TREE_LINE.exec(line);
    if (!match) continue;
    const [, indent, label, , end, rows, loops] = match;
    const depth = indent!.length;
    const current = treeStep(label!);
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
  return roots.map(mergeFilters);
}

const READ_LINES: [RegExp, Access][] = [
  [/^Table scan on (\S+)/, "full"],
  [/^(?:Covering )?[Ii]ndex scan on (\S+) using (\S+)/, "index-full"],
  [/^Single-row (?:covering )?index lookup on (\S+) using (\S+) \((.*)\)/, "unique"],
  [/^Covering index (?:lookup|range scan) on (\S+) using (\S+) (?:over )?\((.*)\)/, "index-only"],
  [/^Index (?:lookup|range scan) on (\S+) using (\S+) (?:over )?\((.*)\)/, "index"],
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
  return { ...read, filter: current.filter, ...(measured ? { measured } : {}) };
}
