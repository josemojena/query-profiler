import {
  asNumber,
  asText,
  parseJson,
  step,
  type Access,
  type Measured,
  type PlanStep,
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

/** MariaDB's `EXPLAIN FORMAT=JSON` and `ANALYZE FORMAT=JSON`, as steps. */
export function readMariadbPlan(output: unknown): PlanStep[] {
  const parsed = parseJson(output) as Json;
  return block(parsed.query_block as Json | undefined);
}

function block(node: Json | undefined): PlanStep[] {
  if (!node) return [];
  const steps: PlanStep[] = [];
  if (typeof node.message === "string") steps.push(step({ label: node.message, kind: "other" }));
  if (node.query_block) steps.push(...block(node.query_block as Json));
  if (node.table) steps.push(table(node.table as Json));
  if (Array.isArray(node.nested_loop)) {
    const tables = (node.nested_loop as Json[]).flatMap(block);
    steps.push(
      ...(tables.length > 1 ? [step({ label: "Nested loop", kind: "join" }, tables)] : tables),
    );
  }
  const sorted = node.read_sorted_file as Json | undefined;
  if (sorted) steps.push(...block(sorted));
  const filesort = node.filesort as Json | undefined;
  if (filesort)
    steps.push(
      step(
        {
          label: "filesort",
          kind: "sort",
          keys: asText(filesort.sort_key)?.split(/,\s*(?![^(]*\))/),
          measured: loopsOnly(filesort),
        },
        block(filesort),
      ),
    );
  const temporary = node.temporary_table as Json | undefined;
  if (temporary)
    steps.push(
      step({ label: "temporary table", kind: "group", temporary: true }, block(temporary)),
    );
  const distinct = node.duplicate_removal as Json | undefined;
  if (distinct) steps.push(step({ label: "duplicate removal", kind: "group" }, block(distinct)));
  const join = node["block-nl-join"] as Json | undefined;
  if (join) steps.push(...joinBuffer(join));
  for (const subquery of (node.subqueries as Json[] | undefined) ?? [])
    steps.push(...block(subquery));
  const union = node.union_result as Json | undefined;
  if (union)
    steps.push(
      step(
        { label: "union", kind: "other" },
        ((union.query_specifications as Json[] | undefined) ?? []).flatMap(block),
      ),
    );
  return steps;
}

// The table read for a block nested loop join is the inner side, read in full for each batch.
function joinBuffer(join: Json): PlanStep[] {
  const [inner] = block(join);
  if (!inner) return [];
  const condition = asText(join.attached_condition);
  return [
    {
      ...inner,
      notes: [...(inner.notes ?? []), `Using join buffer (${String(join.join_type ?? "BNL")})`],
      ...(condition ? { filter: condition } : {}),
    },
  ];
}

function table(node: Json): PlanStep {
  const accessType = String(node.access_type ?? "");
  const access = ACCESS[accessType];
  const rowsRead = asNumber(node.rows);
  const filtered = asNumber(node.filtered);
  return step(
    {
      label: accessType || "table",
      kind: "read",
      table: asText(node.table_name),
      access: access === "index" && node.using_index === true ? "index-only" : access,
      index: asText(node.key),
      lookup: (node.used_key_parts as string[] | undefined)?.join(", "),
      filter: asText(node.attached_condition),
      possibleIndexes: node.possible_keys as string[] | undefined,
      rows:
        rowsRead === undefined || filtered === undefined
          ? undefined
          : Math.round(((rowsRead * filtered) / 100) * 100) / 100,
      rowsRead,
      cost: asNumber(node.cost),
      notes: [asText(node.index_condition) && "Using index condition", asText(node.message)].filter(
        (note): note is string => typeof note === "string",
      ),
      measured: measure(node),
    },
    [...block(node.materialized as Json | undefined), ...block(node.derived as Json | undefined)],
  );
}

// MariaDB gives the rows read per loop, and the share of them the condition kept.
function measure(node: Json): Measured | undefined {
  const loops = asNumber(node.r_loops);
  const perLoop = asNumber(node.r_rows);
  if (loops === undefined || perLoop === undefined)
    return loops === 0 ? { rows: 0, loops } : undefined;
  const read = perLoop * loops;
  const kept = (asNumber(node.r_filtered) ?? 100) / 100;
  const ms = (asNumber(node.r_table_time_ms) ?? 0) + (asNumber(node.r_other_time_ms) ?? 0);
  return {
    rows: Math.round(read * kept * 100) / 100,
    loops,
    ms: Math.round(ms * 1000) / 1000,
    removedByFilter: Math.round(read * (1 - kept) * 100) / 100,
  };
}

function loopsOnly(node: Json): Measured | undefined {
  const loops = asNumber(node.r_loops);
  if (loops === undefined) return undefined;
  const ms = asNumber(node.r_total_time_ms);
  return {
    rows: asNumber(node.r_output_rows) ?? 0,
    loops,
    ...(ms === undefined ? {} : { ms: Math.round(ms * 1000) / 1000 }),
  };
}
