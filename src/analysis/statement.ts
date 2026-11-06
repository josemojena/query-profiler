import { matchParens, tokenize, type Range } from "../ui/sql-tokens.js";
import type { TableName } from "./catalog.js";
import type { Engine } from "./plan.js";

/** How a condition can use an index: by equality, by range, by pattern, or hardly at all. */
export type ConditionKind = "equality" | "range" | "pattern" | "negation" | "null" | "other";

export interface ColumnReference {
  /** The table the column belongs to, when the SQL makes it clear. */
  table?: TableName;
  column: string;
}

export type Operand =
  | { kind: "param"; positions: number[] }
  | { kind: "literal"; text: string }
  | { kind: "column"; column: ColumnReference }
  | { kind: "list"; size?: number; positions: number[] }
  | { kind: "subquery" }
  | { kind: "expression"; text: string; positions: number[] };

export interface Condition {
  column: ColumnReference;
  /** As written, in capitals: =, IN, LIKE, IS NOT NULL… A NOT in front makes it NOT IN, NOT =… */
  operator: string;
  kind: ConditionKind;
  /** What wraps the column, when something does: lower(), a cast (::text), COLLATE… */
  wrapper?: string;
  value: Operand;
  /** Joined to others with OR, so an index on its column alone may not serve. */
  alternative: boolean;
  clause: "where" | "join" | "having";
}

export interface SortKey {
  column?: ColumnReference;
  /** The key as written, when it is not a plain column. */
  expression?: string;
  descending: boolean;
}

/** A LIMIT or an OFFSET: a number written in the SQL, or a parameter's position. */
export interface Count {
  value?: number;
  position?: number;
}

/** One SELECT, or the rows an INSERT, UPDATE or DELETE writes. */
export interface Query {
  kind: "select" | "insert" | "update" | "delete";
  tables: { table: TableName; alias?: string }[];
  conditions: Condition[];
  orderBy: SortKey[];
  groupBy: ColumnReference[];
  limit?: Count;
  offset?: Count;
  distinct: boolean;
  /** SELECT * or t.* */
  everyColumn: boolean;
  subqueries: Query[];
}

export interface Statement {
  query: Query;
  /** Every query in the statement, its own first, then each subquery. */
  queries: Query[];
  /** Every table the SQL reads or writes. */
  tables: TableName[];
  /** The table behind a name a plan uses: an alias, or the table's own name. */
  tableOf(name: string): TableName | undefined;
  /** The most items of any IN list. */
  longestList: number;
}

type PieceKind =
  | "string"
  | "name"
  | "param"
  | "word"
  | "open"
  | "close"
  | "comma"
  | "number"
  | "dot"
  | "star"
  | "operator";

interface Piece {
  kind: PieceKind;
  text: string;
  upper: string;
}

interface Scope {
  tables: { table: TableName; alias?: string }[];
  /** Names of derived tables and CTEs: their columns belong to no real table. */
  derived: Set<string>;
  parent?: Scope;
}

// What the shared tokenizer leaves as "other": numbers, the dot of a qualified name, * and operators.
const OTHER =
  /(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\.)|(\*)|(::|<=|>=|<>|!=|==|->>|->|#>>|#>|@>|<@|&&|\|\||!~\*|!~|~\*|\?\||\?&|@@|[^\s\d.*])/g;
const COMPARISONS = new Set([
  "=",
  "==",
  "<>",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "@>",
  "<@",
  "&&",
  "~",
  "~*",
  "!~",
  "!~*",
  "@@",
]);
const PATTERNS = new Set(["LIKE", "ILIKE", "GLOB", "REGEXP", "RLIKE", "SIMILAR"]);
const NEGATABLE = new Set(["IN", "LIKE", "ILIKE", "BETWEEN", "SIMILAR", "REGEXP", "RLIKE", "GLOB"]);
const EQUALITIES = new Set(["=", "==", "IN", "IS NOT DISTINCT FROM"]);
const RANGES = new Set(["<", "<=", ">", ">=", "BETWEEN"]);
const NEGATIONS = new Set(["<>", "!=", "IS DISTINCT FROM"]);
const FLIPPED: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
const JOIN_WORDS = new Set([
  "NATURAL",
  "LEFT",
  "RIGHT",
  "FULL",
  "INNER",
  "OUTER",
  "CROSS",
  "JOIN",
  "STRAIGHT_JOIN",
  "LATERAL",
]);
const NOT_ALIASES = new Set(
  `ON USING JOIN LEFT RIGHT INNER FULL CROSS NATURAL OUTER WHERE GROUP ORDER LIMIT OFFSET HAVING
  WINDOW UNION EXCEPT INTERSECT SET FOR LATERAL USE FORCE IGNORE STRAIGHT_JOIN RETURNING VALUES
  FETCH LOCK TABLESAMPLE DEFAULT SELECT INDEXED NOT`.split(/\s+/),
);
const NOT_COLUMNS = new Set(
  `NULL TRUE FALSE DEFAULT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP LOCALTIME LOCALTIMESTAMP
  CASE WHEN THEN ELSE END NOT EXISTS SELECT INTERVAL ARRAY ROW DISTINCT AND OR AS ANY SOME ALL`.split(
    /\s+/,
  ),
);
const SELECT_CLAUSES = [
  "FROM",
  "WHERE",
  "GROUP",
  "HAVING",
  "WINDOW",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "FETCH",
  "FOR",
  "LOCK",
];
const SET_OPERATIONS = new Set(["UNION", "INTERSECT", "EXCEPT"]);
const MODIFIERS = new Set([
  "ALL",
  "SQL_CALC_FOUND_ROWS",
  "HIGH_PRIORITY",
  "STRAIGHT_JOIN",
  "SQL_NO_CACHE",
  "SQL_SMALL_RESULT",
  "SQL_BIG_RESULT",
  "SQL_BUFFER_RESULT",
  "LOW_PRIORITY",
  "QUICK",
  "IGNORE",
  "ONLY",
  "DELAYED",
]);

/** The tables, conditions, sorting and limits of a statement, read from its SQL without the database. */
export function readStatement(sql: string, engine: Engine): Statement {
  const pieces = toPieces(sql);
  const pairs = matchParens(pieces);
  const positions = paramPositions(pieces);
  // PostgreSQL folds unquoted names to lowercase; MySQL and SQLite compare them in any case.
  const key = (name: string) => (engine === "postgres" ? name : name.toLowerCase());
  const queries: Query[] = [];
  let longestList = 0;

  const upper = (index: number) => pieces[index]?.upper ?? "";
  const kindAt = (index: number) => pieces[index]?.kind;
  const closing = (index: number) => pairs.get(index) ?? index;
  // Past a parenthesized group, so its contents never count at the level around it.
  const step = (index: number) => (kindAt(index) === "open" ? closing(index) + 1 : index + 1);
  const atLevel = ({ from, to }: Range) => {
    const indexes: number[] = [];
    for (let index = from; index < to; index = step(index)) indexes.push(index);
    return indexes;
  };
  const isSubquery = (index: number) =>
    kindAt(index) === "open" && ["SELECT", "WITH", "VALUES"].includes(upper(index + 1));
  const unwrap = (range: Range): Range => {
    let current = range;
    while (
      current.from < current.to &&
      kindAt(current.from) === "open" &&
      closing(current.from) === current.to - 1 &&
      !isSubquery(current.from)
    )
      current = { from: current.from + 1, to: current.to - 1 };
    return current;
  };
  const text = ({ from, to }: Range) =>
    pieces
      .slice(from, to)
      .map((piece) => piece.text)
      .join(" ");
  const paramsIn = ({ from, to }: Range) =>
    pieces.flatMap((_, index) =>
      index >= from && index < to && positions.has(index) ? [positions.get(index)!] : [],
    );
  const identifier = (index: number) => {
    const piece = pieces[index]!;
    if (piece.kind !== "name") return engine === "postgres" ? piece.text.toLowerCase() : piece.text;
    const quote = piece.text[0]!;
    return piece.text.slice(1, -1).replaceAll(quote + quote, quote);
  };
  const isIdentifier = (index: number) =>
    kindAt(index) === "name" || (kindAt(index) === "word" && !NOT_COLUMNS.has(upper(index)));

  /**
   * name, name.name or name.name.name from `index`, unless it is a t.* or, when `call` is false, a
   * function call.
   */
  function chain(index: number, call = false): { parts: string[]; end: number } | undefined {
    if (!isIdentifier(index)) return undefined;
    const parts = [identifier(index)];
    let end = index + 1;
    while (kindAt(end) === "dot" && (kindAt(end + 1) === "name" || kindAt(end + 1) === "word")) {
      parts.push(identifier(end + 1));
      end += 2;
    }
    if ((kindAt(end) === "open" && !call) || (kindAt(end) === "dot" && kindAt(end + 1) === "star"))
      return undefined;
    return { parts, end };
  }

  function resolve(parts: string[], scope: Scope): ColumnReference {
    const column = parts.at(-1)!;
    const qualifier = parts.slice(0, -1);
    if (qualifier.length >= 2)
      return { table: { schema: qualifier.at(-2), name: qualifier.at(-1)! }, column };
    if (qualifier.length === 0) {
      const [only] = scope.tables;
      return scope.tables.length === 1 && !scope.derived.size
        ? { table: only!.table, column }
        : { column };
    }
    const name = key(qualifier[0]!);
    for (let current: Scope | undefined = scope; current; current = current.parent) {
      const match =
        current.tables.find((entry) => entry.alias !== undefined && key(entry.alias) === name) ??
        current.tables.find((entry) => key(entry.table.name) === name);
      if (match) return { table: match.table, column };
      if (current.derived.has(name)) return { column };
    }
    return { column };
  }

  function query(range: Range, parent: Scope | undefined, derived: Set<string>): Query {
    const current = unwrap(range);
    const scope: Scope = { tables: [], derived: new Set(derived), parent };
    const result: Query = {
      kind: "select",
      tables: scope.tables,
      conditions: [],
      orderBy: [],
      groupBy: [],
      distinct: false,
      everyColumn: false,
      subqueries: [],
    };
    queries.push(result);
    if (upper(current.from) === "WITH") return withQuery(current, result, scope);
    const parts = splitSetOperations(current);
    if (parts.length > 1) {
      const [first, ...rest] = parts;
      Object.assign(result, { ...query(first!, parent, derived), subqueries: [] });
      queries.splice(queries.indexOf(result), 1);
      for (const part of rest) result.subqueries.push(query(part, parent, derived));
      return result;
    }
    switch (upper(current.from)) {
      case "SELECT":
        selectQuery(current, result, scope);
        break;
      case "INSERT":
      case "REPLACE":
        insertQuery(current, result, scope);
        break;
      case "UPDATE":
        updateQuery(current, result, scope);
        break;
      case "DELETE":
        deleteQuery(current, result, scope);
        break;
      default:
        result.subqueries.push(...subqueriesIn(current, scope));
    }
    return result;
  }

  function splitSetOperations(range: Range): Range[] {
    const parts: Range[] = [];
    let start = range.from;
    for (const index of atLevel(range))
      if (SET_OPERATIONS.has(upper(index))) {
        parts.push({ from: start, to: index });
        start = ["ALL", "DISTINCT"].includes(upper(index + 1)) ? index + 2 : index + 1;
      }
    parts.push({ from: start, to: range.to });
    return parts;
  }

  // WITH [RECURSIVE] name [(columns)] AS [NOT] [MATERIALIZED] (body), … then the statement.
  function withQuery(range: Range, result: Query, scope: Scope): Query {
    let index = range.from + 1;
    if (upper(index) === "RECURSIVE") index += 1;
    const names = new Set(scope.derived);
    while (index < range.to && isIdentifier(index)) {
      names.add(key(identifier(index)));
      index += 1;
      if (kindAt(index) === "open") index = closing(index) + 1;
      if (upper(index) === "AS") index += 1;
      while (upper(index) === "NOT" || upper(index) === "MATERIALIZED") index += 1;
      if (kindAt(index) !== "open") break;
      result.subqueries.push(query({ from: index + 1, to: closing(index) }, scope.parent, names));
      index = closing(index) + 1;
      if (kindAt(index) !== "comma") break;
      index += 1;
    }
    const main = query({ from: index, to: range.to }, scope.parent, names);
    queries.splice(queries.indexOf(main), 1);
    queries.splice(queries.indexOf(result), 1, main);
    main.subqueries.unshift(...result.subqueries);
    return main;
  }

  /** Where each clause starts, among `names`, at the level of `range`. */
  function clauses(range: Range, names: string[]): Map<string, Range> {
    const starts: [string, number, number][] = [];
    for (const index of atLevel(range)) {
      const word = upper(index);
      if (!names.includes(word) || kindAt(index) !== "word") continue;
      if ((word === "GROUP" || word === "ORDER") && upper(index + 1) !== "BY") continue;
      // a IS [NOT] DISTINCT FROM b compares, it does not start a clause.
      if (word === "FROM" && upper(index - 1) === "DISTINCT") continue;
      if (word === "FOR" && !["UPDATE", "SHARE", "NO", "KEY"].includes(upper(index + 1))) continue;
      if (word === "LOCK" && upper(index + 1) !== "IN") continue;
      starts.push([word, index, word === "GROUP" || word === "ORDER" ? 2 : 1]);
    }
    const found = new Map<string, Range>();
    starts.forEach(([word, index, words], position) => {
      if (!found.has(word))
        found.set(word, { from: index + words, to: starts[position + 1]?.[1] ?? range.to });
    });
    return found;
  }

  function selectQuery(range: Range, result: Query, scope: Scope) {
    let index = range.from + 1;
    if (upper(index) === "DISTINCT") {
      result.distinct = true;
      index += 1;
      if (upper(index) === "ON" && kindAt(index + 1) === "open") index = closing(index + 1) + 1;
    }
    while (MODIFIERS.has(upper(index))) index += 1;
    const body = { from: index, to: range.to };
    const parts = clauses(body, SELECT_CLAUSES);
    const list = {
      from: index,
      to: Math.min(...[...parts.values()].map((part) => part.from - 1), range.to),
    };
    const from = parts.get("FROM");
    if (from) fromItems(from, result, scope);
    result.everyColumn = atLevel(list).some(
      (at) =>
        kindAt(at) === "star" &&
        (at === list.from || kindAt(at - 1) === "dot" || kindAt(at - 1) === "comma"),
    );
    result.subqueries.push(...subqueriesIn(list, scope));
    filter(parts.get("WHERE"), "where", result, scope);
    const group = parts.get("GROUP");
    if (group)
      for (const item of items(group)) {
        const found = term(item, scope);
        if (found?.kind === "column") result.groupBy.push(found.column);
      }
    filter(parts.get("HAVING"), "having", result, scope);
    const order = parts.get("ORDER");
    if (order) result.orderBy = sortKeys(order, scope);
    counts(parts, result);
  }

  function insertQuery(range: Range, result: Query, scope: Scope) {
    result.kind = "insert";
    const into = atLevel(range).find((index) => upper(index) === "INTO");
    // The table's column list follows it: INSERT INTO t (a, b).
    const target = into === undefined ? undefined : chain(into + 1, true);
    if (target) {
      result.tables.push({ table: tableName(target.parts) });
      const source = atLevel({ from: target.end, to: range.to }).find(
        (index) => upper(index) === "SELECT" || upper(index) === "WITH",
      );
      if (source !== undefined) {
        const end = atLevel({ from: source, to: range.to }).find(
          (index) => upper(index) === "ON" || upper(index) === "RETURNING",
        );
        result.subqueries.push(query({ from: source, to: end ?? range.to }, scope, scope.derived));
      }
    }
    result.subqueries.push(
      ...subqueriesIn({ from: target?.end ?? range.from, to: range.to }, scope),
    );
  }

  function updateQuery(range: Range, result: Query, scope: Scope) {
    result.kind = "update";
    let index = range.from + 1;
    while (MODIFIERS.has(upper(index)) || upper(index) === "OR")
      index += upper(index) === "OR" ? 2 : 1;
    const parts = clauses({ from: index, to: range.to }, [
      "SET",
      "FROM",
      "WHERE",
      "ORDER",
      "LIMIT",
      "RETURNING",
    ]);
    const set = parts.get("SET");
    fromItems({ from: index, to: set ? set.from - 1 : range.to }, result, scope);
    const from = parts.get("FROM");
    if (from) fromItems(from, result, scope);
    if (set) result.subqueries.push(...subqueriesIn(set, scope));
    filter(parts.get("WHERE"), "where", result, scope);
    const order = parts.get("ORDER");
    if (order) result.orderBy = sortKeys(order, scope);
    counts(parts, result);
  }

  function deleteQuery(range: Range, result: Query, scope: Scope) {
    result.kind = "delete";
    const parts = clauses({ from: range.from + 1, to: range.to }, [
      "FROM",
      "USING",
      "WHERE",
      "ORDER",
      "LIMIT",
      "RETURNING",
    ]);
    const from = parts.get("FROM");
    if (from) fromItems(from, result, scope);
    const using = parts.get("USING");
    if (using) fromItems(using, result, scope);
    filter(parts.get("WHERE"), "where", result, scope);
    const order = parts.get("ORDER");
    if (order) result.orderBy = sortKeys(order, scope);
    counts(parts, result);
  }

  function tableName(parts: string[]): TableName {
    const name = parts.at(-1)!;
    return parts.length > 1 ? { schema: parts.at(-2), name } : { name };
  }

  // FROM a, b JOIN c ON … LEFT JOIN (SELECT …) d ON …: tables, derived tables and join conditions.
  function fromItems(range: Range, result: Query, scope: Scope) {
    let index = range.from;
    while (index < range.to) {
      while (index < range.to && (JOIN_WORDS.has(upper(index)) || kindAt(index) === "comma"))
        index += 1;
      if (index >= range.to) break;
      if (kindAt(index) === "open") {
        const end = closing(index);
        if (isSubquery(index))
          result.subqueries.push(query({ from: index + 1, to: end }, scope, scope.derived));
        else fromItems({ from: index + 1, to: end }, result, scope);
        index = end + 1;
        const alias = aliasAt(index);
        if (alias) {
          scope.derived.add(key(alias.name));
          index = alias.end;
        }
      } else {
        const name = chain(index);
        if (!name) {
          // A table function, such as generate_series(…) or json_each(…): its rows are no table.
          index = kindAt(index + 1) === "open" ? closing(index + 1) + 1 : index + 1;
          const alias = aliasAt(index);
          if (alias) {
            scope.derived.add(key(alias.name));
            index = alias.end;
          }
          continue;
        }
        index = name.end;
        const alias = aliasAt(index);
        const table = tableName(name.parts);
        if (scope.derived.has(key(table.name)) && name.parts.length === 1) {
          if (alias) scope.derived.add(key(alias.name));
        } else scope.tables.push(alias ? { table, alias: alias.name } : { table });
        if (alias) index = alias.end;
        // MySQL's index hints: USE INDEX (…), FORCE KEY (…), IGNORE INDEX FOR JOIN (…).
        while (
          ["USE", "FORCE", "IGNORE"].includes(upper(index)) &&
          ["INDEX", "KEY"].includes(upper(index + 1))
        ) {
          index += 2;
          while (kindAt(index) !== "open" && index < range.to) index += 1;
          index = closing(index) + 1;
        }
      }
      if (upper(index) === "ON") {
        const end = atLevel({ from: index + 1, to: range.to }).find(
          (at) => kindAt(at) === "comma" || (JOIN_WORDS.has(upper(at)) && upper(at) !== "OUTER"),
        );
        filter({ from: index + 1, to: end ?? range.to }, "join", result, scope);
        index = end ?? range.to;
      } else if (upper(index) === "USING" && kindAt(index + 1) === "open")
        index = closing(index + 1) + 1;
      else if (index < range.to && !JOIN_WORDS.has(upper(index)) && kindAt(index) !== "comma")
        index += 1;
    }
  }

  function aliasAt(index: number): { name: string; end: number } | undefined {
    const at = upper(index) === "AS" ? index + 1 : index;
    if (kindAt(at) === "name" || (kindAt(at) === "word" && !NOT_ALIASES.has(upper(at)))) {
      // A derived table's column list: AS t(a, b).
      const end = kindAt(at + 1) === "open" ? closing(at + 1) + 1 : at + 1;
      return { name: identifier(at), end };
    }
    return undefined;
  }

  function filter(
    range: Range | undefined,
    clause: Condition["clause"],
    result: Query,
    scope: Scope,
  ) {
    if (range) conditions(range, clause, false, false, result, scope);
  }

  function conditions(
    range: Range,
    clause: Condition["clause"],
    alternative: boolean,
    negated: boolean,
    result: Query,
    scope: Scope,
  ) {
    const current = unwrap(range);
    if (current.from >= current.to) return;
    const ors = splitAt(current, (index) => upper(index) === "OR");
    if (ors.length > 1) {
      for (const part of ors) conditions(part, clause, true, negated, result, scope);
      return;
    }
    let between = false;
    const ands = splitAt(current, (index) => {
      if (upper(index) === "BETWEEN") between = true;
      if (upper(index) !== "AND") return false;
      if (between) return (between = false);
      return true;
    });
    if (ands.length > 1) {
      for (const part of ands) conditions(part, clause, alternative, negated, result, scope);
      return;
    }
    if (upper(current.from) === "NOT") {
      const rest = { from: current.from + 1, to: current.to };
      const inner = unwrap(rest);
      // NOT (a OR b) is still one condition per column, each negated.
      conditions(inner, clause, alternative, !negated, result, scope);
      return;
    }
    predicate(current, clause, alternative, negated, result, scope);
  }

  function splitAt(range: Range, at: (index: number) => boolean): Range[] {
    const parts: Range[] = [];
    let start = range.from;
    for (const index of atLevel(range))
      if (at(index)) {
        parts.push({ from: start, to: index });
        start = index + 1;
      }
    parts.push({ from: start, to: range.to });
    return parts.filter((part) => part.from < part.to);
  }

  function operatorIn(range: Range): { at: number; end: number; operator: string } | undefined {
    for (const index of atLevel(range)) {
      const piece = pieces[index]!;
      if (piece.kind === "operator" && COMPARISONS.has(piece.text))
        return { at: index, end: index + 1, operator: piece.text };
      if (piece.kind !== "word" || index === range.from) continue;
      if (piece.upper === "IS") {
        let next = index + 1;
        let operator = "IS";
        if (upper(next) === "NOT") {
          operator += " NOT";
          next += 1;
        }
        if (upper(next) === "DISTINCT" && upper(next + 1) === "FROM")
          return { at: index, end: next + 2, operator: `${operator} DISTINCT FROM` };
        return { at: index, end: next + 1, operator: `${operator} ${upper(next)}` };
      }
      if (piece.upper === "NOT" && NEGATABLE.has(upper(index + 1))) {
        const words = upper(index + 1) === "SIMILAR" ? 3 : 2;
        return { at: index, end: index + words, operator: `NOT ${upper(index + 1)}` };
      }
      if (piece.upper === "IN" || piece.upper === "BETWEEN" || PATTERNS.has(piece.upper))
        return {
          at: index,
          end: index + (piece.upper === "SIMILAR" ? 2 : 1),
          operator: piece.upper === "SIMILAR" ? "SIMILAR TO" : piece.upper,
        };
    }
    return undefined;
  }

  function predicate(
    range: Range,
    clause: Condition["clause"],
    alternative: boolean,
    negated: boolean,
    result: Query,
    scope: Scope,
  ) {
    const found = operatorIn(range);
    if (!found) {
      result.subqueries.push(...subqueriesIn(range, scope));
      return;
    }
    let operator = found.operator;
    let left = term({ from: range.from, to: found.at }, scope);
    let right = term(
      { from: found.end, to: range.to },
      scope,
      operator === "IN" || operator === "NOT IN",
    );
    if (left?.kind !== "column" && right?.kind === "column" && COMPARISONS.has(operator)) {
      [left, right] = [right, left];
      operator = FLIPPED[operator] ?? operator;
    }
    if (left?.kind !== "column") {
      for (const side of [left, right])
        if (side?.kind === "subquery") result.subqueries.push(side.query);
      if (!left && !right) result.subqueries.push(...subqueriesIn(range, scope));
      return;
    }
    if (right?.kind === "subquery") result.subqueries.push(right.query);
    const value: Operand =
      right === undefined
        ? { kind: "literal", text: "" }
        : right.kind === "subquery"
          ? { kind: "subquery" }
          : right.kind === "column"
            ? { kind: "column", column: right.column }
            : right.operand;
    if (value.kind === "list") longestList = Math.max(longestList, value.size ?? 0);
    const written = negated ? `NOT ${operator}` : operator;
    result.conditions.push({
      column: left.column,
      operator: written,
      kind: kindOf(operator, negated),
      ...(left.wrapper ? { wrapper: left.wrapper } : {}),
      value,
      alternative,
      clause,
    });
  }

  type Term =
    | { kind: "column"; column: ColumnReference; wrapper?: string }
    | { kind: "subquery"; query: Query }
    | { kind: "operand"; operand: Operand };

  function term(range: Range, scope: Scope, list = false): Term | undefined {
    // IN ($1) is a list of one: its parentheses are the list's, not a group's.
    if (list && kindAt(range.from) === "open" && closing(range.from) === range.to - 1) {
      if (!isSubquery(range.from)) {
        const inner = { from: range.from + 1, to: range.to - 1 };
        return {
          kind: "operand",
          operand: { kind: "list", size: items(inner).length, positions: paramsIn(inner) },
        };
      }
    }
    const current = unwrap(range);
    if (current.from >= current.to) return undefined;
    const { from, to } = current;
    const found = chain(from);
    if (found) {
      const column = resolve(found.parts, scope);
      if (found.end === to) return { kind: "column", column };
      if (upper(found.end) === "::" || upper(found.end) === "COLLATE")
        return {
          kind: "column",
          column,
          wrapper: `${upper(found.end) === "::" ? "::" : "COLLATE "}${text({ from: found.end + 1, to }).toLowerCase()}`,
        };
    }
    if (kindAt(from) === "word" && kindAt(from + 1) === "open" && closing(from + 1) === to - 1) {
      const name = upper(from);
      const inner = { from: from + 2, to: to - 1 };
      if (name === "ANY" || name === "SOME")
        return { kind: "operand", operand: { kind: "list", positions: paramsIn(inner) } };
      const argument = items(inner)
        .map((item) => unwrap(item))
        .find((item) => chain(item.from)?.end === item.to || (name === "CAST" && chain(item.from)));
      if (argument) {
        const column = resolve(chain(argument.from)!.parts, scope);
        return {
          kind: "column",
          column,
          wrapper:
            name === "CAST"
              ? `cast as ${text({ from: chain(argument.from)!.end + 1, to: argument.to }).toLowerCase()}`
              : `${name.toLowerCase()}()`,
        };
      }
    }
    if (isSubquery(from) && closing(from) === to - 1)
      return {
        kind: "subquery",
        query: query({ from: from + 1, to: to - 1 }, scope, scope.derived),
      };
    if (to - from === 1 && kindAt(from) === "param")
      return { kind: "operand", operand: { kind: "param", positions: paramsIn(current) } };
    if (
      to - from === 1 &&
      (kindAt(from) === "string" || kindAt(from) === "number" || NOT_COLUMNS.has(upper(from)))
    )
      return { kind: "operand", operand: { kind: "literal", text: pieces[from]!.text } };
    return {
      kind: "operand",
      operand: { kind: "expression", text: text(current), positions: paramsIn(current) },
    };
  }

  /** Comma-separated items at the level of `range`. */
  function items(range: Range): Range[] {
    return splitAt(range, (index) => kindAt(index) === "comma");
  }

  function sortKeys(range: Range, scope: Scope): SortKey[] {
    return items(range).map((item) => {
      let end = item.to;
      let descending = false;
      const words = atLevel(item);
      for (const index of words.reverse()) {
        const word = upper(index);
        if (word === "DESC" || word === "ASC") {
          descending = word === "DESC";
          end = Math.min(end, index);
        } else if (word === "NULLS" || word === "COLLATE") end = Math.min(end, index);
      }
      const found = term({ from: item.from, to: end }, scope);
      return found?.kind === "column" && !found.wrapper
        ? { column: found.column, descending }
        : { expression: text({ from: item.from, to: end }), descending };
    });
  }

  function count(index: number): Count | undefined {
    if (kindAt(index) === "param") return { position: positions.get(index)! };
    if (kindAt(index) === "number") return { value: Number(pieces[index]!.text) };
    if (pieces[index]?.text === "-" && kindAt(index + 1) === "number")
      return { value: -Number(pieces[index + 1]!.text) };
    return undefined;
  }

  // LIMIT n, LIMIT offset, n (MySQL), OFFSET n, FETCH FIRST n ROWS ONLY.
  function counts(parts: Map<string, Range>, result: Query) {
    const limit = parts.get("LIMIT");
    if (limit) {
      const [first, second] = items(limit);
      if (second) {
        result.offset = count(first!.from);
        result.limit = count(second.from);
      } else result.limit = count(limit.from);
    }
    const offset = parts.get("OFFSET");
    if (offset) result.offset = count(offset.from);
    const fetch = parts.get("FETCH");
    if (fetch) result.limit = count(fetch.from + 1) ?? { value: 1 };
    for (const field of ["limit", "offset"] as const) if (!result[field]) delete result[field];
  }

  /** The queries in parentheses anywhere in `range`, outside the conditions already read. */
  function subqueriesIn(range: Range, scope: Scope): Query[] {
    const found: Query[] = [];
    for (let index = range.from; index < range.to; index += 1)
      if (isSubquery(index)) {
        found.push(query({ from: index + 1, to: closing(index) }, scope, scope.derived));
        index = closing(index);
      }
    return found;
  }

  const root = query({ from: 0, to: pieces.length }, undefined, new Set());
  const tables = [
    ...new Map(
      queries
        .flatMap((each) => each.tables)
        .map(({ table }) => [`${table.schema ?? ""}.${key(table.name)}`, table]),
    ).values(),
  ];
  return {
    query: root,
    queries,
    tables,
    tableOf(name) {
      const wanted = key(name);
      const entries = queries.flatMap((each) => each.tables);
      return (
        entries.find((entry) => entry.alias !== undefined && key(entry.alias) === wanted)?.table ??
        entries.find((entry) => key(entry.table.name) === wanted)?.table
      );
    },
    longestList,
  };
}

function kindOf(operator: string, negated: boolean): ConditionKind {
  if (operator === "IS NULL") return negated ? "negation" : "null";
  // A B-tree index finds the rows that are not NULL as a range.
  if (operator === "IS NOT NULL") return negated ? "null" : "range";
  if (negated || operator.startsWith("NOT ") || NEGATIONS.has(operator)) return "negation";
  if (EQUALITIES.has(operator)) return "equality";
  if (RANGES.has(operator)) return "range";
  if (PATTERNS.has(operator) || operator === "SIMILAR TO" || operator.startsWith("~"))
    return "pattern";
  return "other";
}

function toPieces(sql: string): Piece[] {
  const tokens = tokenize(sql);
  // With $1 parameters, a ? is one of PostgreSQL's JSON operators.
  const numbered = tokens.some((token) => token.kind === "param" && token.text.startsWith("$"));
  const pieces: Piece[] = [];
  for (const token of tokens) {
    if (token.kind === "comment") continue;
    if (token.kind === "param" && numbered && token.text === "?") {
      pieces.push({ kind: "operator", text: "?", upper: "?" });
      continue;
    }
    if (token.kind !== "other") {
      pieces.push({ kind: token.kind, text: token.text, upper: token.upper });
      continue;
    }
    for (const match of token.text.matchAll(OTHER)) {
      const kind: PieceKind = match[1]
        ? "number"
        : match[2]
          ? "dot"
          : match[3]
            ? "star"
            : "operator";
      pieces.push({ kind, text: match[0], upper: match[0] });
    }
  }
  return pieces;
}

/** Each parameter's position, from 1: the number of a $n, or the order of a ?. */
function paramPositions(pieces: Piece[]): Map<number, number> {
  const positions = new Map<number, number>();
  let ordinal = 0;
  pieces.forEach((piece, index) => {
    if (piece.kind !== "param") return;
    positions.set(index, piece.text.startsWith("$") ? Number(piece.text.slice(1)) : ++ordinal);
  });
  return positions;
}
