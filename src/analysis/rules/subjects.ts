import {
  adviseIndex,
  adviseSortIndex,
  patternText,
  sameTable,
  usableWrapper,
  wantedColumns,
  writeAdvice,
  type IndexAdvice,
} from "../advisor.js";
import type { Table, TableName } from "../catalog.js";
import { allSteps, type Engine, type Plan, type PlanStep } from "../plan.js";
import type { Condition, Count, Query, Statement } from "../statement.js";
import type { Subject, SubjectKind } from "./engine.js";

/** Fewer rows than this, and reading them all is often what the database should do. */
export const SMALL_TABLE = 1000;
export const DEEP_OFFSET = 1000;
export const LONG_LIST = 100;
export const HUGE_LIST = 1000;
export const MANY_LOOPS = 100;
/** Estimated and measured rows this many times apart. */
export const MISESTIMATE = 10;
const WASTE = 10;
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
  statement: Statement;
  plan?: Plan;
  tables: Table[];
  params: unknown[];
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
      existing: table?.indexes ?? [],
      joins: inner || filteredElsewhere(identity),
    };
    const wanted = input ? wantedColumns(input) : [];
    const advice = input && table ? adviseIndex(input) : undefined;
    const rows = table?.rows ?? step.rowsRead ?? step.rows;
    const measured = step.measured;
    const estimated = step.rows;
    const ratio =
      measured && estimated !== undefined
        ? Math.max(measured.rows / Math.max(estimated, 1), estimated / Math.max(measured.rows, 1))
        : 0;
    const removed = measured?.removedByFilter ?? 0;
    return subject(
      "read",
      {
        full: step.access === "full",
        indexFull: step.access === "index-full",
        indexed: ["index", "index-only", "unique"].includes(step.access ?? ""),
        covering: step.access === "index-only",
        automatic: step.access === "automatic-index",
        filtered: Boolean(step.filter || step.lookup) || wanted.length > 0,
        missing: advice !== undefined,
        served: wanted.length > 0 && advice === undefined && table !== undefined,
        small: rows !== undefined && rows < SMALL_TABLE,
        unanalyzed: table !== undefined && !table.analyzed,
        known: table !== undefined,
        measured: measured !== undefined,
        misestimated:
          ratio >= MISESTIMATE &&
          Math.max(measured?.rows ?? 0, estimated ?? 0) >= SMALL_TABLE / 10 &&
          !stopsEarly(step),
        manyLoops: (measured?.loops ?? 0) >= MANY_LOOPS,
        inner,
        joinBuffer: (step.notes ?? []).some((note) => note.startsWith("Using join buffer")),
        wasteful: removed >= WASTED_ROWS && removed >= WASTE * Math.max(measured?.rows ?? 0, 1),
        considered: (step.possibleIndexes?.length ?? 0) > 0 && !step.index,
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
      },
      { advice, step: position, table: identity },
    );
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

  // Under a LIMIT, or in a semi or anti join (EXISTS, NOT EXISTS), the database stops reading once
  // it has what it needs: fewer rows than estimated is no misestimate.
  function stopsEarly(step: PlanStep): boolean {
    for (let parent = parents.get(step); parent; parent = parents.get(parent))
      if (parent.kind === "limit" || /semi|anti/i.test(parent.label)) return true;
    return false;
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
    table: { schema: table.schema, name: table.name },
    conditions: statement.queries.flatMap((query) => query.conditions),
    orderBy: statement.query.orderBy,
    params: context.params,
    existing: table.indexes,
  });
}

function conditionSubjects({ statement, params }: Context): Analyzed[] {
  return statement.queries.flatMap((query) =>
    query.conditions.map((condition) => {
      const pattern =
        condition.kind === "pattern" ? patternText(condition.value, params) : undefined;
      const others = query.conditions.filter(
        (other) => other.alternative && other.column.column !== condition.column.column,
      );
      const size = condition.value.kind === "list" ? condition.value.size : undefined;
      return subject(
        "condition",
        {
          leadingWildcard: pattern !== undefined && /^[%_]/.test(pattern),
          insensitive: /ILIKE$/.test(condition.operator),
          wrapped: !usableWrapper(condition.wrapper),
          negation: condition.kind === "negation",
          alternative: condition.alternative,
          mixedOr: condition.alternative && others.length > 0,
          longList: (size ?? 0) >= LONG_LIST,
          hugeList: (size ?? 0) >= HUGE_LIST,
          equalsNull:
            ["=", "<>", "!="].includes(condition.operator) &&
            condition.value.kind === "literal" &&
            condition.value.text.toUpperCase() === "NULL",
          notInSubquery: condition.operator === "NOT IN" && condition.value.kind === "subquery",
          join: condition.clause === "join",
          having: condition.clause === "having",
          written: query.kind !== "select",
        },
        {
          table: condition.column.table?.name,
          column: qualified(condition),
          wrapper: condition.wrapper,
          operator: condition.operator,
          size,
        },
        { table: condition.column.table, column: condition.column.column },
      );
    }),
  );
}

function querySubject({ statement, params }: Context): Analyzed {
  const query: Query = statement.query;
  const offset = countValue(query.offset, params);
  const random = query.orderBy.some((key) =>
    /^(?:random|rand)\s*\(\s*\)$/i.test(key.expression ?? ""),
  );
  const written = query.kind === "update" || query.kind === "delete";
  return subject(
    "query",
    {
      deepOffset: (offset ?? 0) >= DEEP_OFFSET,
      randomOrder: random,
      everyColumn: query.everyColumn,
      unfilteredWrite: written && query.conditions.length === 0 && query.tables.length === 1,
      limited: hasLimit(query.limit, params),
      write: written,
    },
    { offset, limit: countValue(query.limit, params), table: query.tables[0]?.table.name },
  );
}

function foreignKeySubjects({ tables, engine }: Context): Analyzed[] {
  return tables.flatMap((table) =>
    table.foreignKeys.map((key) => {
      const columns = new Set(key.columns);
      const indexed = table.indexes.some(
        (index) =>
          !index.expression &&
          !index.where &&
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
              ),
        },
      );
    }),
  );
}

function indexSubjects({ tables }: Context): Analyzed[] {
  return tables.flatMap((table) =>
    table.indexes.map((index) => {
      const comparable = (other: (typeof table.indexes)[number]) =>
        other !== index &&
        !other.expression &&
        !other.where &&
        (other.method ?? "") === (index.method ?? "");
      const plain = !index.expression && !index.where && !index.unique && !index.primary;
      const longer = table.indexes.find(
        (other) =>
          comparable(other) &&
          other.columns.length > index.columns.length &&
          index.columns.every((column, at) => other.columns[at] === column),
      );
      const same = table.indexes.find(
        (other) =>
          comparable(other) &&
          other.columns.join("\u0000") === index.columns.join("\u0000") &&
          (other.primary || other.unique || other.name < index.name),
      );
      return subject(
        "index",
        { redundant: plain && longer !== undefined, duplicate: plain && same !== undefined },
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
