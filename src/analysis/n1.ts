import type { OperationRecord, Profile, StackFrame } from "../core/index.js";
import { REDACTED } from "../core/redact.js";
import type { Schema, SchemaField, SchemaModel } from "./schema.js";

const LISTED = 10;
const INLINE_WIDTH = 64;
const READS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
]);
const SOURCES = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
]);
const PAGING = ["take", "skip", "cursor", "distinct"];
const NESTED_WRITES = ["create", "createMany", "connect", "connectOrCreate", "upsert", "set"];

/** A line of a fix's code; `added` marks what it adds to code the app already has. */
export interface FixLine {
  text: string;
  added?: true;
}

/** One way to replace a loop of queries. */
export interface FixOption {
  /** "In the query before", "One query for all of them". */
  title: string;
  /** What it uses, for a line in a terminal: "include", "groupBy", "createMany". */
  short: string;
  lines: FixLine[];
  /** The queries it takes, and the ones the loop took for the same work. */
  queries: number;
  instead: number;
  /** What to do with what it gives back. */
  note?: string;
}

/** What an N+1 repeats, and the code that replaces the loop. */
export interface N1Fix {
  /** The repeated call, "Post.count", or "raw SQL". */
  operation: string;
  times: number;
  origin?: StackFrame;
  /** The argument that changed each time, and its values (the first ones, when there are many). */
  varying?: { path: string; values: unknown[]; count: number };
  /** The earlier call those values came from, one call per row it returned. */
  source?: { operation: string; origin?: StackFrame; rows: number };
  /** The relation behind it, from the schema: "Post.authorId points to User". */
  relation?: string;
  /** Best first; none when no single query replaces the loop. */
  options: FixOption[];
  /** Why no single query replaces the loop, or what to know first. */
  note?: string;
}

type Args = Record<string, unknown>;

/** For each N+1 of a profile, by the id of its first query: what repeats, and how to stop it. */
export function n1Fixes(profile: Profile, schema?: Schema): Record<string, N1Fix> {
  const fixes: Record<string, N1Fix> = {};
  for (const warning of profile.warnings) {
    if (warning.kind !== "n+1" || !warning.queryIds[0]) continue;
    fixes[warning.queryIds[0]] = fixFor(profile, warning.queryIds, schema);
  }
  return fixes;
}

function fixFor(profile: Profile, queryIds: string[], schema: Schema | undefined): N1Fix {
  const queries = profile.queries.filter((query) => queryIds.includes(query.id));
  const ops = profile.operations.filter((op) => queries.some((query) => query.opId === op.id));
  const [first] = ops;
  if (!first)
    return {
      operation: "raw SQL",
      times: queries.length,
      origin: queries[0]?.origin?.[0],
      options: [],
      note: "One statement with IN, or = ANY($1) on PostgreSQL, reads every value at once.",
    };
  const base: N1Fix = {
    operation: nameOf(first),
    times: ops.length,
    origin: first.origin?.[0],
    options: [],
  };
  const model = first.model;
  if (!model || ops.some((op) => op.model !== model || op.action !== first.action))
    return { ...base, note: "The calls differ: no single query replaces them." };
  const loopQueries = statementsOf(profile, ops) || queries.length;
  const leaves = ops.map((op) => flatten(op.args));
  // A hidden secret may differ from one call to the next: it counts as changing.
  const varying = [...new Set(leaves.flatMap((leaf) => [...leaf.keys()]))].filter(
    (path) =>
      leaves.some((leaf) => leaf.get(path) === REDACTED) ||
      new Set(leaves.map((leaf) => JSON.stringify(leaf.get(path)))).size > 1,
  );
  const context: Context = { profile, ops, first, model, loopQueries, varying, leaves, schema };
  if (READS.has(first.action)) return { ...base, ...readFix(context) };
  if (first.action === "create") return { ...base, ...createFix(context) };
  if (first.action === "update" || first.action === "delete")
    return { ...base, ...writeFix(context) };
  return {
    ...base,
    note: `No single query does what ${first.action} does for each row: Promise.all runs them at once, still ${ops.length} queries.`,
  };
}

interface Context {
  profile: Profile;
  ops: OperationRecord[];
  first: OperationRecord;
  model: string;
  loopQueries: number;
  varying: string[];
  leaves: Map<string, unknown>[];
  schema: Schema | undefined;
}

type Found = Partial<Pick<N1Fix, "varying" | "source" | "relation" | "options" | "note">>;

/** The one key a read looks up by: `where.authorId` changing, everything else the same. */
function readFix(context: Context): Found {
  const { first, model, varying, leaves, ops, loopQueries } = context;
  const path = varying.length === 1 ? /^where\.(\w+)(?:\.equals)?$/.exec(varying[0]!) : null;
  if (!path)
    return {
      note: varying.length
        ? `More than the key changes each time (${varying.join(", ")}): no single query replaces the loop as it is.`
        : "Each call is the same: load it once and keep the result.",
    };
  const field = path[1]!;
  const values = distinct(leaves.map((leaf) => leaf.get(varying[0]!)));
  const args = (first.args ?? {}) as Args;
  const where = withoutKey((args.where ?? {}) as Args, field);
  const shown = { path: field, values: values.slice(0, LISTED), count: values.length };
  const linked = context.schema && linkedSource(context, field);
  const options: FixOption[] = linked?.option ? [linked.option] : [];
  // The earlier read stays: the values still come from it.
  const kept = linked ? queriesOf(linked.op) : 0;
  const together = oneQuery(model, first.action, args, where, field, values);
  if (together)
    options.push({
      ...together,
      title: "One query for all of them",
      queries: kept + 1,
      instead: kept + loopQueries,
    });
  const paged = PAGING.filter((key) => key in args);
  const note = !options.length
    ? `Each call pages on its own (${paged.join(", ")}): one query would page them all together.`
    : ops.length !== values.length
      ? `${ops.length - values.length} of the ${ops.length} calls repeat a ${field} already asked for.`
      : undefined;
  return {
    varying: shown,
    ...(linked
      ? {
          source: {
            operation: nameOf(linked.op),
            origin: linked.op.origin?.[0],
            rows: rowsOf(context.profile, linked.op) ?? 0,
          },
          relation: linked.relation,
        }
      : {}),
    options,
    ...(note ? { note } : {}),
  };
}

function oneQuery(
  model: string,
  action: string,
  args: Args,
  where: Args,
  field: string,
  values: unknown[],
): Pick<FixOption, "short" | "lines" | "note"> | undefined {
  const lookup = { ...where, [field]: { in: listOf(values, field) } };
  if (action === "count") {
    if ("select" in args) return undefined;
    return {
      short: "groupBy",
      lines: call(model, "groupBy", { by: [field], where: lookup, _count: { _all: true } }),
      note: `Then match each count by ${field}: one with no rows gets none, so count it as 0.`,
    };
  }
  if (PAGING.some((key) => key in args)) return undefined;
  const one = action.startsWith("findFirst");
  return {
    short: "findMany with in",
    lines: call(model, "findMany", { ...args, where: lookup }),
    note: one
      ? `It returns every match: keep the first of each ${field}.`
      : `Then find each one by ${field}.`,
  };
}

interface Linked {
  op: OperationRecord;
  relation: string;
  option?: FixOption;
}

/**
 * The earlier read the values came from, through a relation in the schema, and the include that
 * loads the loop's rows with it: one call per row it returned.
 */
function linkedSource(context: Context, field: string): Linked | undefined {
  const { schema, model, first, ops, profile } = context;
  const own = schema?.models.find((each) => each.name === model);
  if (!schema || !own) return undefined;
  const start = profile.operations.indexOf(first);
  const earlier = (parent: string) =>
    profile.operations
      .slice(0, start)
      .reverse()
      .find(
        (op) => op.model === parent && SOURCES.has(op.action) && rowsOf(profile, op) === ops.length,
      );
  // The loop's key holds the relation (Post.authorId): each parent row loads its children.
  const holding = own.fields.find((each) => each.relation?.fields.includes(field));
  if (holding) {
    const parent = schema.models.find((each) => each.name === holding.type);
    const back = parent && backRelation(parent, own, holding);
    const op = parent && earlier(parent.name);
    if (!back || !op) return undefined;
    return {
      op,
      relation: `${model}.${field} points to ${parent.name}`,
      option: includeOption(context, op, back.name, childrenOf(context, field, back.name)),
    };
  }
  // The loop looks up the key another model points to (User.id): each row loads its parent.
  for (const other of schema.models) {
    const pointing = other.fields.find(
      (each) => each.type === model && !each.list && each.relation?.references.includes(field),
    );
    const op = pointing && earlier(other.name);
    if (!pointing || !op) continue;
    const args = (first.args ?? {}) as Args;
    const shape =
      "select" in args
        ? { select: args.select }
        : "include" in args
          ? { include: args.include }
          : true;
    return {
      op,
      relation: `${other.name}.${pointing.relation!.fields.join(", ")} points to ${model}`,
      option: includeOption(
        context,
        op,
        pointing.name,
        shape,
        `Each ${lower(other.name)} comes with its ${pointing.name}; the loop of lookups goes.`,
      ),
    };
  }
  return undefined;
}

/** What the loop asked of each parent, as an include: a count, the first, or every match. */
function childrenOf(context: Context, field: string, back: string): unknown {
  const { where: given, ...args } = (context.first.args ?? {}) as Args;
  const where = withoutKey((given ?? {}) as Args, field);
  const filtered = Object.keys(where).length ? { where } : {};
  if (context.first.action === "count")
    return { _count: { select: { [back]: Object.keys(filtered).length ? filtered : true } } };
  const shape: Args = { ...filtered, ...args };
  if (context.first.action.startsWith("findFirst")) shape.take = 1;
  return Object.keys(shape).length ? shape : true;
}

function includeOption(
  context: Context,
  op: OperationRecord,
  name: string,
  shape: unknown,
  note?: string,
): FixOption {
  const args = (op.args ?? {}) as Args;
  const count = shape && typeof shape === "object" && "_count" in shape;
  const entry = count ? (shape as Args) : { [name]: shape };
  const key = "select" in args ? "select" : "include";
  const merged = { ...args, [key]: { ...((args[key] ?? {}) as Args), ...entry } };
  const added = new Set(Object.keys(entry).map((each) => `${key}.${each}`));
  if (!(key in args)) added.add(key);
  const own = queriesOf(op);
  return {
    title: "In the query before",
    short: "include",
    lines: call(op.model!, op.action, merged, added),
    queries: count ? own : own + 1,
    instead: own + context.loopQueries,
    note:
      note ??
      (count
        ? `Each ${lower(op.model!)} comes with _count.${name}; the loop of counts goes.`
        : `Each ${lower(op.model!)} comes with its ${name}; the loop goes.`),
  };
}

/** The relation field on `parent` that is the other side of `field` on `child`. */
function backRelation(
  parent: SchemaModel,
  child: SchemaModel,
  field: SchemaField,
): SchemaField | undefined {
  const sides = parent.fields.filter((each) => each.type === child.name && each.relation);
  return (
    sides.find((each) => field.relation?.name && each.relation?.name === field.relation.name) ??
    (sides.length === 1 ? sides[0] : undefined)
  );
}

function createFix(context: Context): Found {
  const { ops, model, loopQueries, schema, profile } = context;
  const rows = ops
    .map((op) => ((op.args ?? {}) as Args).data)
    .filter((row): row is Args => !!row && typeof row === "object" && !Array.isArray(row));
  if (rows.length !== ops.length)
    return { note: "Each create builds its data differently: no single query replaces them." };
  const nested = Object.keys(rows[0]!).filter((key) => isNestedWrite(rows[0]![key]));
  if (!nested.length)
    return {
      options: [
        {
          title: "Create them together",
          short: "createMany",
          lines: call(model, "createMany", { data: listedRows(rows) }),
          queries: 1,
          instead: loopQueries,
          note: "createMany returns how many it created; createManyAndReturn gives the rows back, on PostgreSQL and SQLite.",
        },
      ],
    };
  const relation = nested.length === 1 ? nested[0]! : undefined;
  const writes = relation ? (rows[0]![relation] as Args) : undefined;
  const own = schema?.models.find((each) => each.name === model);
  const field = own?.fields.find((each) => each.name === relation);
  const child = field && schema?.models.find((each) => each.name === field.type);
  const key = child?.fields.find((each) => each.type === model && each.relation?.fields.length);
  const provider = profile.queries.find((query) => query.opId === ops[0]!.id)?.database?.provider;
  const plain = `createMany does not create nested records (${nested.join(", ")}): the ${lower(model)}s first, then the rest.`;
  if (
    !relation ||
    !writes ||
    Object.keys(writes).some((each) => each !== "create") ||
    !child ||
    !key
  )
    return { note: plain };
  if (provider === "mysql")
    return {
      note: `${plain} MySQL has no createManyAndReturn: read the ${lower(model)}s back after createMany, for their ids, then createMany the ${field!.name}.`,
    };
  const parents = rows.map((row) => withoutKey(row, relation));
  const children = rows.flatMap((row, index) =>
    [(row[relation] as Args).create ?? []].flat().map((each) => ({
      ...Object.fromEntries(
        key.relation!.fields.map((name, at) => [
          name,
          new Code(`created[${index}].${key.relation!.references[at]}`),
        ]),
      ),
      ...(each as Args),
    })),
  );
  return {
    note: plain,
    options: [
      {
        title: "Create them together",
        short: "createMany",
        lines: [
          ...call(
            model,
            "createManyAndReturn",
            { data: listedRows(parents) },
            new Set(),
            "const created = await ",
          ),
          ...call(child.name, "createMany", { data: listedRows(children) }, new Set(), "await "),
        ],
        queries: 2,
        instead: loopQueries,
      },
    ],
  };
}

/** update or delete by one key: the same data each time, so one call with in. */
function writeFix(context: Context): Found {
  const { first, model, varying, leaves, loopQueries } = context;
  const path = varying.length === 1 ? /^where\.(\w+)(?:\.equals)?$/.exec(varying[0]!) : null;
  if (!path)
    return {
      note: `Each ${first.action} writes different values: no single query does that. Promise.all runs them at once, still ${context.ops.length} queries.`,
    };
  const field = path[1]!;
  const values = distinct(leaves.map((leaf) => leaf.get(varying[0]!)));
  const args = (first.args ?? {}) as Args;
  const where = {
    ...withoutKey((args.where ?? {}) as Args, field),
    [field]: { in: listOf(values, field) },
  };
  const many = first.action === "update" ? "updateMany" : "deleteMany";
  if (
    first.action === "update" &&
    Object.keys((args.data ?? {}) as Args).some((key) => isNestedWrite((args.data as Args)[key]))
  )
    return { note: "The update also writes related records: updateMany does not." };
  return {
    varying: { path: field, values: values.slice(0, LISTED), count: values.length },
    options: [
      {
        title: "One query for all of them",
        short: many,
        lines: call(
          model,
          many,
          first.action === "update" ? { where, data: args.data } : { where },
        ),
        queries: 1,
        instead: loopQueries,
        note: `${many} returns how many rows it changed, not the rows.`,
      },
    ],
  };
}

const isNestedWrite = (value: unknown) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).some((key) => NESTED_WRITES.includes(key));

/** Every leaf of an object by its dotted path; arrays count as one leaf. */
function flatten(value: unknown, prefix = "", into = new Map<string, unknown>()) {
  if (value && typeof value === "object" && !Array.isArray(value))
    for (const [key, item] of Object.entries(value))
      flatten(item, prefix ? `${prefix}.${key}` : key, into);
  else if (prefix) into.set(prefix, value);
  return into;
}

const distinct = (values: unknown[]) => [
  ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
];

function withoutKey(object: Args, key: string): Args {
  const { [key]: _removed, ...rest } = object;
  return rest;
}

const nameOf = (op: OperationRecord) => (op.model ? `${op.model}.${op.action}` : op.action);
const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

const rowsOf = (profile: Profile, op: OperationRecord) =>
  profile.queries.find((query) => query.id === op.queryIds[0])?.rows;
const queriesOf = (op: OperationRecord) => Math.max(op.queryIds.length, 1);

/** Every statement the calls sent, their transactions' BEGIN and COMMIT included. */
function statementsOf(profile: Profile, ops: OperationRecord[]): number {
  const own = new Set(ops.flatMap((op) => op.queryIds));
  const transactions = new Set(
    profile.queries.filter((query) => own.has(query.id) && query.txId).map((query) => query.txId),
  );
  return profile.queries.filter((query) => own.has(query.id) || transactions.has(query.txId))
    .length;
}

/** Code to write as is: `created[0].id`. */
class Code {
  constructor(readonly text: string) {}
}

/** The values, or a stand-in with a comment when there are too many to write out. */
function listOf(values: unknown[], field: string): unknown {
  if (values.length <= LISTED) return values;
  return new Code(
    `${field}s /* ${values.length} values: ${values
      .slice(0, 3)
      .map((value) => JSON.stringify(value))
      .join(", ")}, … */`,
  );
}

/** Rows to write out: the first few, then a comment for the rest. */
function listedRows(rows: Args[]): unknown[] {
  if (rows.length <= 3) return rows;
  return [...rows.slice(0, 2), new Code(`// … ${rows.length - 2} more, as in the loop`)];
}

/** A Prisma call as code: `prisma.post.findMany({ … })`, with the lines it adds marked. */
function call(
  model: string,
  action: string,
  args: unknown,
  added = new Set<string>(),
  lead = "",
): FixLine[] {
  // What is added shows on lines of its own, so a call that fits on one line opens up.
  const body = print(args, "", added, "", added.size > 0);
  const [head, ...rest] = body;
  const lines = [
    { ...head!, text: `${lead}prisma.${lower(model)}.${action}(${head!.text}` },
    ...rest,
  ];
  const last = lines[lines.length - 1]!;
  lines[lines.length - 1] = { ...last, text: `${last.text})${lead ? ";" : ""}` };
  return lines;
}

function print(
  value: unknown,
  indent: string,
  added: Set<string>,
  path: string,
  open = false,
): FixLine[] {
  const inline = inlineOf(value);
  if (!open && inline !== undefined && inline.length <= INLINE_WIDTH) return [{ text: inline }];
  if (Array.isArray(value)) {
    const items = value.flatMap((item) =>
      withComma(print(item, `${indent}  `, added, path), `${indent}  `, item),
    );
    return [{ text: "[" }, ...items, { text: `${indent}]` }];
  }
  if (value && typeof value === "object" && !(value instanceof Code)) {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      const at = path ? `${path}.${key}` : key;
      const lines = print(item, `${indent}  `, added, at);
      const [head, ...rest] = lines;
      const entry = [{ ...head!, text: `${indent}  ${keyOf(key)}: ${head!.text}` }, ...rest];
      const closed = [
        ...entry.slice(0, -1),
        { ...entry[entry.length - 1]!, text: `${entry[entry.length - 1]!.text},` },
      ];
      // An entry written on one line that holds what was added is added as a whole.
      const holds =
        added.has(at) ||
        (closed.length === 1 && [...added].some((each) => each.startsWith(`${at}.`)));
      return holds ? closed.map((line) => ({ ...line, added: true as const })) : closed;
    });
    return [{ text: "{" }, ...entries, { text: `${indent}}` }];
  }
  return [{ text: inline ?? "undefined" }];
}

function withComma(lines: FixLine[], indent: string, item: unknown): FixLine[] {
  const [head, ...rest] = lines;
  const all = [{ ...head!, text: `${indent}${head!.text}` }, ...rest];
  if (item instanceof Code && item.text.startsWith("//")) return all;
  return [...all.slice(0, -1), { ...all[all.length - 1]!, text: `${all[all.length - 1]!.text},` }];
}

function inlineOf(value: unknown): string | undefined {
  if (value instanceof Code) return value.text;
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.some((item) => item instanceof Code && item.text.startsWith("//"))) return undefined;
    const items = value.map(inlineOf);
    return items.includes(undefined) ? undefined : `[${items.join(", ")}]`;
  }
  const entries = Object.entries(value).map(([key, item]) => {
    const text = inlineOf(item);
    return text === undefined ? undefined : `${keyOf(key)}: ${text}`;
  });
  if (entries.includes(undefined)) return undefined;
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

const keyOf = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));
