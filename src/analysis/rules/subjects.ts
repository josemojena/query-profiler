import {
  adviseIndex,
  adviseSortIndex,
  patternClass,
  patternText,
  sameTable,
  unservedPrefix,
  usableWrapper,
  wantedColumns,
  writeAdvice,
  type IndexAdvice,
} from "../advisor.js";
import type { Index, Table, TableName } from "../catalog.js";
import { allSteps, type Engine, type Plan, type PlanStep } from "../plan.js";
import type { Condition, Count, Operand, Query, Statement } from "../statement.js";
import type { Subject, SubjectKind } from "./engine.js";

// What MySQL and MariaDB say when the constants alone show no row can match.
const IMPOSSIBLE =
  /Impossible (?:WHERE|HAVING)(?: noticed after reading const tables)?|no matching row in const table|const row not found|unique row not found|No matching min\/max row|Zero limit|No matching rows after partition pruning/i;
const TEXT_TYPE = /char|text|enum|set/i;

/** Fewer rows than this, and reading them all is often what the database should do. */
export const SMALL_TABLE = 1000;
export const DEEP_OFFSET = 1000;
/** A read with no limit that returned this many rows or more is likely loading more than it shows. */
export const MANY_ROWS = 1000;
// MySQL estimates an IN list of more than 200 values from statistics instead of the index itself.
export const LONG_LIST = 200;
export const HUGE_LIST = 1000;
export const MANY_LOOPS = 100;
/** Estimated and measured rows this many times apart. */
export const MISESTIMATE = 10;
const WASTE = 10;
/** A filter that keeps a fifth of a table or more: an index finds those rows no cheaper. */
const BROAD = 0.2;
const WASTED_ROWS = 1000;

export interface Analyzed extends Subject {
  advice?: IndexAdvice;
  /** The plan step it is about, by its place among allSteps(plan.steps). */
  step?: number;
  table?: TableName;
  column?: string;
}

export interface Context {
  engine: Engine;
  /** The engine's version, when the database was asked. */
  version?: string;
  statement: Statement;
  plan?: Plan;
  tables: Table[];
  params: unknown[];
  /** The rows the query returned, when it ran. */
  returned?: number;
}

/** Everything the rules look at in one query, each with its facts and values. */
export function subjects(context: Context): Analyzed[] {
  return [
    ...planSubjects(context),
    ...conditionSubjects(context),
    querySubject(context),
    ...foreignKeySubjects(context),
    ...indexSubjects(context),
  ];
}

const subject = (
  kind: SubjectKind,
  facts: Record<string, boolean>,
  values: Analyzed["values"],
  extra: Partial<Analyzed> = {},
): Analyzed => ({ kind, facts, values, ...extra });

function planSubjects(context: Context): Analyzed[] {
  const { plan, statement, engine } = context;
  if (!plan) return [];
  const steps = allSteps(plan.steps);
  const parents = new Map<PlanStep, PlanStep>();
  for (const parent of steps) for (const child of parent.children) parents.set(child, parent);
  const conditions = statement.queries.flatMap((query) => query.conditions);
  const limited = hasLimit(statement.query.limit, context.params);
  const written = statement.query.kind === "update" || statement.query.kind === "delete";

  return steps.flatMap((step, position): Analyzed[] => {
    if (step.kind === "read") return [readSubject(step, position)];
    if (step.kind === "sort" || step.kind === "group") {
      const advice = sortAdvice(context);
      return [
        subject(
          step.kind,
          {
            temporary: step.temporary === true,
            onDisk: step.onDisk === true,
            limited,
            sortable: advice !== undefined,
            measured: step.measured !== undefined,
          },
          {
            keys: step.keys?.join(", "),
            table: advice?.table.name,
            columns: advice?.columns.map((column) => column.name).join(", "),
          },
          { advice, step: position, table: advice?.table },
        ),
      ];
    }
    return [];
  });

  function readSubject(step: PlanStep, position: number): Analyzed {
    const named = statement.tableOf(step.table ?? step.relation ?? "");
    const name: TableName | undefined =
      named ??
      ((step.relation ?? step.table) ? { name: (step.relation ?? step.table)! } : undefined);
    const table = name && context.tables.find((candidate) => sameTable(engine, candidate, name));
    const identity = table ? { schema: table.schema, name: table.name } : name;
    const inner = innerSide(step);
    const input = identity && {
      engine,
      table: identity,
      conditions,
      orderBy: statement.query.orderBy,
      params: context.params,
      existing: (table?.indexes ?? []).filter((index) => index.valid !== false),
      columns: table?.columns,
      joins: inner || filteredElsewhere(identity),
      version: context.version,
    };
    const wanted = input ? wantedColumns(input) : [];
    const visibleAdvice = input && table ? adviseIndex(input) : undefined;
    // An index the optimizer may not use, which would serve the read if it could.
    const hidden =
      input && visibleAdvice
        ? input.existing.find(
            (index) =>
              index.visible === false &&
              !adviseIndex({ ...input, existing: [{ ...index, visible: true }] }),
          )
        : undefined;
    const advice = hidden ? undefined : visibleAdvice;
    const like = table && identity ? unservedLike(table, identity) : undefined;
    const rows = table?.rows ?? step.rowsRead ?? step.rows;
    const measured = step.measured;
    // Estimates are per loop; what ran is measured over every loop.
    const estimated = step.rows;
    const actual = measured && measured.loops > 0 ? measured.rows / measured.loops : undefined;
    const ratio =
      actual !== undefined && estimated !== undefined
        ? Math.max(actual / Math.max(estimated, 1), estimated / Math.max(actual, 1))
        : 0;
    const removed = measured?.removedByFilter ?? 0;
    const buried = table && advice ? buriedIndex(table, wanted) : undefined;
    const related = table ? relatedColumns(table, identity!) : [];
    const heapFetches = measured?.heapFetches ?? 0;
    const batches = hashBatches(step);
    const share =
      step.rows !== undefined && table?.rows ? Math.min(step.rows / table.rows, 1) : undefined;
    return subject(
      "read",
      {
        full: step.access === "full",
        indexFull: step.access === "index-full",
        indexed: ["index", "index-only", "unique"].includes(step.access ?? ""),
        covering: step.access === "index-only",
        automatic: step.access === "automatic-index",
        // Rows kept or found by a condition: an index read only for its order filters nothing.
        filtered:
          Boolean(step.filter || step.lookup) ||
          conditions.some(
            (condition) =>
              condition.value.kind !== "column" &&
              condition.clause !== "having" &&
              identity !== undefined &&
              condition.column.table !== undefined &&
              sameTable(engine, condition.column.table, identity),
          ),
        missing: advice !== undefined,
        served: wanted.length > 0 && advice === undefined && table !== undefined && !hidden,
        hiddenIndex: hidden !== undefined,
        nocaseNeeded: engine === "sqlite" && like !== undefined,
        patternOpsNeeded: engine === "postgres" && like !== undefined && !like.leading,
        small: rows !== undefined && rows < SMALL_TABLE,
        unanalyzed: table !== undefined && !table.analyzed,
        known: table !== undefined,
        measured: measured !== undefined,
        misestimated:
          ratio >= MISESTIMATE &&
          Math.max(actual ?? 0, estimated ?? 0) >= SMALL_TABLE / 10 &&
          !stopsEarly(step),
        manyLoops: (measured?.loops ?? 0) >= MANY_LOOPS,
        inner,
        joinBuffer: (step.notes ?? []).some((note) => note.startsWith("Using join buffer")),
        wasteful: removed >= WASTED_ROWS && removed >= WASTE * Math.max(measured?.rows ?? 0, 1),
        considered: (step.possibleIndexes?.length ?? 0) > 0 && !step.index,
        buried: buried !== undefined,
        // The query stops at a LIMIT: reading in an index's order until then is cheap.
        limited,
        // So many rows match that reading them all is what an index would cost too.
        broad: share !== undefined && share >= BROAD,
        withoutValues: plan?.generic === true || plan?.approximate === true,
        stale:
          table !== undefined &&
          table.analyzed &&
          table.modified !== undefined &&
          table.analyzeAfter !== undefined &&
          table.modified >= table.analyzeAfter,
        correlated: related.length >= 2,
        heapVisits:
          step.label === "Index Only Scan" &&
          heapFetches >= 1000 &&
          heapFetches >= 0.1 * (measured?.rows ?? 0),
        hashSpill: (batches ?? 0) > 1,
        write: written,
      },
      {
        table: identity?.name,
        rows,
        columns: (advice?.columns ?? wanted).map((column) => column.name).join(", "),
        index: step.index,
        filter: step.filter,
        loops: measured?.loops,
        removed,
        estimated,
        actual: measured?.rows,
        possible: step.possibleIndexes?.join(", "),
        share: share === undefined ? undefined : Math.round(share * 100),
        buriedIn: buried?.name,
        leading: buried?.columns[0],
        modified: table?.modified,
        related: related.join(", "),
        heapFetches,
        batches,
        hidden: hidden?.name,
        like: like?.column,
        operatorClass: patternClass(like?.type),
      },
      { advice, step: position, table: identity },
    );
  }

  // A LIKE with a fixed start on this table that a plain index would not serve, and none of its indexes does.
  function unservedLike(table: Table, identity: TableName) {
    return conditions
      .filter(
        (condition) =>
          !condition.alternative &&
          condition.clause !== "having" &&
          condition.column.table !== undefined &&
          sameTable(engine, condition.column.table, identity),
      )
      .map((condition) => unservedPrefix(engine, condition, context.params, table))
      .find((unserved) => unserved !== undefined);
  }

  // The inner side of a nested loop is read again for every row of the outer side; a hash join, a
  // merge join, a Materialize or a join buffer read it once.
  function innerSide(step: PlanStep): boolean {
    if ((step.notes ?? []).some((note) => note.startsWith("Using join buffer"))) return false;
    let child = step;
    for (let parent = parents.get(child); parent; child = parent, parent = parents.get(parent)) {
      if (parent.label === "Materialize" || parent.label === "Hash") return false;
      if (parent.kind !== "join") continue;
      const loop = /^nested loop/i.test(parent.label);
      return loop && parent.children.indexOf(child) > 0;
    }
    if (engine !== "sqlite") return false;
    // SQLite lists the tables of a join in loop order, outer first, as siblings.
    const siblings = parents.get(step)?.children ?? plan!.steps;
    return siblings.filter((sibling) => sibling.kind === "read").indexOf(step) > 0;
  }

  // Under a LIMIT, in a semi or anti join (EXISTS, NOT EXISTS), or on a merge join's inner side,
  // the database stops reading once it has what it needs: fewer rows than estimated is no
  // misestimate. MySQL's and MariaDB's JSON have no LIMIT step: the query's own LIMIT stands in.
  function stopsEarly(step: PlanStep): boolean {
    if (limited && !steps.some((each) => each.kind === "limit")) return true;
    let child = step;
    for (let parent = parents.get(child); parent; child = parent, parent = parents.get(parent)) {
      if (parent.kind === "limit" || /semi|anti/i.test(parent.label)) return true;
      if (/^merge join/i.test(parent.label) && parent.children.indexOf(child) > 0) return true;
    }
    return false;
  }

  // The hash a read feeds, before any join: its batches say whether it went to disk.
  function hashBatches(step: PlanStep): number | undefined {
    for (let parent = parents.get(step); parent; parent = parents.get(parent)) {
      if (parent.kind === "join") return undefined;
      if (parent.label === "Hash") return parent.batches;
    }
    return undefined;
  }

  // Equality filters on several columns of this table, which the planner takes for independent
  // unless extended statistics cover two of them.
  function relatedColumns(table: Table, identity: TableName): string[] {
    const columns = [
      ...new Set(
        conditions
          .filter(
            (condition) =>
              condition.kind === "equality" &&
              !condition.alternative &&
              condition.clause === "where" &&
              condition.value.kind !== "column" &&
              condition.column.table !== undefined &&
              sameTable(engine, condition.column.table, identity),
          )
          .map((condition) => condition.column.column),
      ),
    ];
    const covered = (table.statistics ?? []).some(
      (statistics) => columns.filter((column) => statistics.columns.includes(column)).length >= 2,
    );
    return columns.length >= 2 && !covered ? columns : [];
  }

  // A filter on another table makes its rows few, and this table is reached through the join.
  function filteredElsewhere(table: TableName): boolean {
    return conditions.some(
      (condition) =>
        !condition.alternative &&
        condition.value.kind !== "column" &&
        condition.column.table !== undefined &&
        !sameTable(engine, condition.column.table, table) &&
        ["equality", "range", "null"].includes(condition.kind),
    );
  }
}

function sortAdvice(context: Context): IndexAdvice | undefined {
  const { statement, engine } = context;
  const [first] = statement.query.orderBy;
  const owner = first?.column?.table;
  if (!owner) return undefined;
  const table = context.tables.find((candidate) => sameTable(engine, candidate, owner));
  if (!table) return undefined;
  return adviseSortIndex({
    engine,
    version: context.version,
    table: { schema: table.schema, name: table.name },
    conditions: statement.queries.flatMap((query) => query.conditions),
    orderBy: statement.query.orderBy,
    params: context.params,
    existing: table.indexes.filter((index) => index.valid !== false),
    columns: table.columns,
  });
}

function conditionSubjects({ statement, params, tables, engine }: Context): Analyzed[] {
  return statement.queries.flatMap((query) =>
    query.conditions.map((condition) => {
      const pattern =
        condition.kind === "pattern" ? patternText(condition.value, params) : undefined;
      const searched =
        condition.kind === "pattern" ? fullPattern(condition.value, params) : undefined;
      const others = query.conditions.filter(
        (other) => other.alternative && other.column.column !== condition.column.column,
      );
      const value = condition.value;
      const size = value.kind === "list" ? value.size : undefined;
      const valued = value.kind === "param" || value.kind === "list";
      const table = condition.column.table;
      const owner = table && tables.find((each) => sameTable(engine, each, table));
      const partial = valued
        ? owner?.indexes.find(
            (index) => index.where && mentions(index.where, condition.column.column),
          )
        : undefined;
      const unserved = owner ? unservedPrefix(engine, condition, params, owner) : undefined;
      return subject(
        "condition",
        {
          leadingWildcard: pattern !== undefined && /^[%_]/.test(pattern),
          insensitive: /ILIKE$/.test(condition.operator) || /~\*$/.test(condition.operator),
          // A trigram index looks up runs of three characters: a shorter run gives it nothing.
          fewTrigrams:
            searched !== undefined &&
            Math.max(0, ...searched.split(/[%_]+/).map((run) => run.length)) < 3,
          wrapped: !usableWrapper(condition.wrapper),
          negation: condition.kind === "negation",
          alternative: condition.alternative,
          mixedOr: condition.alternative && others.length > 0,
          longList: (size ?? 0) >= LONG_LIST,
          hugeList: (size ?? 0) >= HUGE_LIST,
          equalsNull:
            ["=", "<>", "!="].includes(condition.operator) &&
            value.kind === "literal" &&
            value.text.toUpperCase() === "NULL",
          notInSubquery: condition.operator === "NOT IN" && value.kind === "subquery",
          nullInList:
            condition.operator === "NOT IN" &&
            value.kind === "list" &&
            (value.hasNull === true ||
              value.positions.some((position) => params[position - 1] === null)),
          partialParam: partial !== undefined,
          numberOnString: numberOnText(condition, tables, engine, params),
          join: condition.clause === "join",
          having: condition.clause === "having",
          written: query.kind !== "select",
          patternOpsMissing: engine === "postgres" && unserved?.leading !== undefined,
        },
        {
          table: table?.name,
          expression: condition.expression,
          column: qualified(condition),
          wrapper: condition.wrapper,
          operator: condition.operator,
          size,
          index: partial?.name,
          predicate: partial?.where,
          leadingIndex: unserved?.leading?.name,
          operatorClass: patternClass(unserved?.type),
        },
        {
          table: owner ? { schema: owner.schema, name: owner.name } : table,
          column: condition.column.column,
        },
      );
    }),
  );
}

function querySubject({ statement, params, tables, plan, engine, returned }: Context): Analyzed {
  const query: Query = statement.query;
  const offset = countValue(query.offset, params);
  const random = query.orderBy.some((key) =>
    /^(?:random|rand)\s*\(\s*\)$/i.test(key.expression ?? ""),
  );
  const written = query.kind === "update" || query.kind === "delete";
  const [only] = statement.tables;
  const counted = only && tables.find((table) => sameTable(engine, table, only))?.rows;
  const unfiltered = statement.queries.every((each) => each.conditions.length === 0);
  const { planningMs, executionMs, jitMs } = plan?.timing ?? {};
  const reason = plan
    ? allSteps(plan.steps)
        .flatMap((step) => [step.label, ...(step.notes ?? [])])
        .map((text) => IMPOSSIBLE.exec(text)?.[0])
        .find((found) => found !== undefined)
    : undefined;
  const unstable = unstableOrder(query, tables, engine);
  const tenth = (ms: number | undefined) =>
    ms === undefined ? undefined : Math.round(ms * 10) / 10;
  return subject(
    "query",
    {
      deepOffset: (offset ?? 0) >= DEEP_OFFSET,
      manyRows: (returned ?? 0) >= MANY_ROWS,
      randomOrder: random,
      everyColumn: query.everyColumn,
      unfilteredWrite: written && query.conditions.length === 0 && query.tables.length === 1,
      limited: hasLimit(query.limit, params),
      write: written,
      unordered: query.kind === "select" && query.orderBy.length === 0,
      // Prisma sends OFFSET 0 when there is no skip.
      paged: (offset ?? 0) > 0,
      countsAll:
        query.countOnly === true &&
        unfiltered &&
        statement.tables.length === 1 &&
        (counted ?? 0) >= SMALL_TABLE,
      jitHeavy: jitMs !== undefined && executionMs !== undefined && jitMs >= 0.2 * executionMs,
      impossible: reason !== undefined,
      unstableOrder: unstable,
      planningHeavy:
        planningMs !== undefined &&
        executionMs !== undefined &&
        planningMs >= 5 &&
        planningMs >= 2 * executionMs,
    },
    {
      offset,
      limit: countValue(query.limit, params),
      table: only?.name ?? query.tables[0]?.table.name,
      rows: counted,
      returned,
      reason,
      keys: query.orderBy.map((key) => key.column?.column ?? key.expression).join(", "),
      jitMs: tenth(jitMs),
      executionMs: tenth(executionMs),
      planningMs: tenth(planningMs),
    },
  );
}

function foreignKeySubjects({ tables, engine, version }: Context): Analyzed[] {
  return tables.flatMap((table) =>
    table.foreignKeys.map((key) => {
      const columns = new Set(key.columns);
      // A lookup by the key's columns needs a B-tree leading with them, or a hash on just one.
      const indexed = table.indexes.some(
        (index) =>
          index.valid !== false &&
          !index.expression &&
          !index.where &&
          (engine === "sqlite" ||
            index.method === undefined ||
            /^btree$/i.test(index.method) ||
            (/^hash$/i.test(index.method) && index.columns.length === 1 && columns.size === 1)) &&
          index.columns.slice(0, columns.size).every((column) => columns.has(column)) &&
          index.columns.length >= columns.size,
      );
      const identity = { schema: table.schema, name: table.name };
      return subject(
        "foreign-key",
        { unindexed: !indexed },
        { table: table.name, columns: key.columns.join(", "), references: key.references.table },
        {
          table: identity,
          advice: indexed
            ? undefined
            : writeAdvice(
                engine,
                identity,
                key.columns.map((name) => ({ name })),
                version,
              ),
        },
      );
    }),
  );
}

function indexSubjects({ tables }: Context): Analyzed[] {
  return tables.flatMap((table) =>
    table.indexes.map((index) => {
      // Key parts with their direction and operator class: (a) and (a DESC), or (title) and
      // (title text_pattern_ops), serve different queries.
      const parts = (of: Index) => of.parts ?? of.columns;
      const comparable = (other: Index) =>
        other !== index &&
        other.valid !== false &&
        other.visible !== false &&
        !other.expression &&
        !other.where &&
        (other.method ?? "") === (index.method ?? "");
      const plain =
        index.valid !== false &&
        index.visible !== false &&
        !index.expression &&
        !index.where &&
        !index.unique &&
        !index.primary;
      const longer = table.indexes.find(
        (other) =>
          comparable(other) &&
          parts(other).length > parts(index).length &&
          parts(index).every((part, at) => parts(other)[at] === part),
      );
      const same = table.indexes.find(
        (other) =>
          comparable(other) &&
          parts(other).join("\u0000") === parts(index).join("\u0000") &&
          (other.primary || other.unique || other.name < index.name),
      );
      return subject(
        "index",
        {
          redundant: plain && longer !== undefined,
          duplicate: plain && same !== undefined,
          invalid: index.valid === false,
          invisible: index.visible === false,
          unique: index.unique || index.primary,
        },
        { table: table.name, index: index.name, other: (same ?? longer)?.name },
        { table: { schema: table.schema, name: table.name } },
      );
    }),
  );
}

/** A LIMIT that limits: SQLite's LIMIT -1 means none. */
function hasLimit(limit: Count | undefined, params: unknown[]): boolean {
  const value = countValue(limit, params);
  return limit !== undefined && (value === undefined || value >= 0);
}

function countValue(count: Count | undefined, params: unknown[]): number | undefined {
  if (!count) return undefined;
  if (count.value !== undefined) return count.value;
  const param = count.position === undefined ? undefined : params[count.position - 1];
  const value = typeof param === "string" ? Number(param) : param;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const qualified = (condition: Condition) =>
  condition.column.table
    ? `${condition.column.table.name}.${condition.column.column}`
    : condition.column.column;

/** An index that has a wanted column, but after another one: it cannot look the column up. */
function buriedIndex(table: Table, wanted: { name: string }[]): Index | undefined {
  const names = new Set(wanted.map((column) => column.name));
  return table.indexes.find(
    (index) =>
      index.valid !== false &&
      index.visible !== false &&
      !index.expression &&
      !index.where &&
      (index.method === undefined || /^btree$/i.test(index.method)) &&
      !names.has(index.columns[0] ?? "") &&
      index.columns.slice(1).some((column) => names.has(column)),
  );
}

/** The pattern a LIKE searches for, with the values of the parameters it is built from. */
function fullPattern(value: Operand, params: unknown[]): string | undefined {
  if (value.kind === "literal") return value.text.replace(/^'|'$/g, "");
  if (value.kind === "param") {
    const param = params[value.positions[0]! - 1];
    return typeof param === "string" ? param : undefined;
  }
  if (value.kind !== "expression") return undefined;
  let ordinal = 0;
  const parts: string[] = [];
  for (const [, text, numbered] of value.text.matchAll(/'((?:[^']|'')*)'|\$(\d+)|\?/g)) {
    if (text !== undefined) parts.push(text);
    else {
      const position = numbered ? Number(numbered) : value.positions[ordinal++];
      const param = position === undefined ? undefined : params[position - 1];
      if (typeof param !== "string") return undefined;
      parts.push(param);
    }
  }
  return parts.join("");
}

/** Whether a partial index's condition names the column. */
const mentions = (where: string, column: string) =>
  new RegExp(`(^|[^\\w])"?${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?([^\\w]|$)`).test(
    where,
  );

/**
 * ORDER BY columns of one table that no unique key covers, with the columns an equality fixes:
 * rows can share them, and their order between pages is not fixed.
 */
function unstableOrder(query: Query, tables: Table[], engine: Engine): boolean {
  const keys = query.orderBy.map((key) => key.column);
  const owner = keys[0]?.table;
  if (
    !keys.length ||
    !owner ||
    keys.some((key) => !key?.table || !sameTable(engine, key.table, owner))
  )
    return false;
  const table = tables.find((candidate) => sameTable(engine, candidate, owner));
  if (!table) return false;
  const fixed = query.conditions
    .filter(
      (condition) =>
        condition.kind === "equality" &&
        !condition.alternative &&
        condition.value.kind !== "column" &&
        condition.column.table !== undefined &&
        sameTable(engine, condition.column.table, owner),
    )
    .map((condition) => condition.column.column);
  const known = new Set([...keys.map((key) => key!.column), ...fixed]);
  return !table.indexes.some(
    (index) =>
      (index.unique || index.primary) &&
      index.valid !== false &&
      !index.where &&
      !index.expression &&
      index.columns.every((column) => known.has(column)),
  );
}

/** A text column compared with a number, which makes the engine convert every row to compare. */
function numberOnText(
  condition: Condition,
  tables: Table[],
  engine: Engine,
  params: unknown[],
): boolean {
  const owner = condition.column.table;
  if (!owner || !["equality", "range", "negation"].includes(condition.kind)) return false;
  const column = tables
    .find((table) => sameTable(engine, table, owner))
    ?.columns.find((each) => each.name.toLowerCase() === condition.column.column.toLowerCase());
  if (!column || !TEXT_TYPE.test(column.type)) return false;
  const value = condition.value;
  const numeric = (param: unknown) => typeof param === "number" || typeof param === "bigint";
  if (value.kind === "literal") return /^-?\d+(?:\.\d+)?$/.test(value.text);
  if (value.kind === "param" || value.kind === "list")
    return (
      value.positions.length > 0 &&
      value.positions.every((position) => numeric(params[position - 1]))
    );
  return false;
}
