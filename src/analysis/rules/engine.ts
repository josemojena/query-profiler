import { atLeast } from "../explain.js";
import type { Engine } from "../plan.js";

export type Severity = "problem" | "warning" | "info";

/** What a rule looks at: a step of the plan, a condition, the whole query, a table's key or index. */
export type SubjectKind =
  | "read"
  | "sort"
  | "group"
  | "condition"
  | "query"
  | "foreign-key"
  | "index";

/**
 * A rule, as one row: [id, subject, engines, when, severity, message, fix, docs].
 * - engines: "*", or engines with an optional version, "postgres@16 sqlite" or "postgres@<18".
 * - when: the subject's facts joined with & | ! and parentheses, "full & missing & !small".
 * - message: text with {placeholders} from the subject's values.
 */
export type Rule = readonly [
  id: string,
  subject: SubjectKind,
  engines: string,
  when: string,
  severity: Severity,
  message: string,
  fix?: string,
  docs?: string,
];

export interface Subject {
  kind: SubjectKind;
  facts: Record<string, boolean>;
  values: Record<string, string | number | undefined>;
}

type Expression =
  | { fact: string }
  | { not: Expression }
  | { and: [Expression, Expression] }
  | { or: [Expression, Expression] };

const TOKENS = /\s*([A-Za-z][\w-]*|[&|!()])/y;

/** A rule's `when`, parsed once: facts, !, & (before |) and parentheses. */
export function parseWhen(when: string): Expression {
  const tokens: string[] = [];
  let read = 0;
  for (;;) {
    TOKENS.lastIndex = read;
    const match = TOKENS.exec(when);
    if (!match) break;
    tokens.push(match[1]!);
    read = TOKENS.lastIndex;
  }
  if (when.slice(read).trim()) throw new Error(`Cannot read "${when}"`);
  let position = 0;
  const peek = () => tokens[position];
  const take = (token: string) => {
    if (tokens[position] !== token) throw new Error(`Expected ${token} in "${when}"`);
    position += 1;
  };
  const primary = (): Expression => {
    const token = tokens[position++];
    if (token === "!") return { not: primary() };
    if (token === "(") {
      const inner = either();
      take(")");
      return inner;
    }
    if (!token || !/^[A-Za-z]/.test(token)) throw new Error(`Expected a fact in "${when}"`);
    return { fact: token };
  };
  const both = (): Expression => {
    let left = primary();
    while (peek() === "&") {
      position += 1;
      left = { and: [left, primary()] };
    }
    return left;
  };
  const either = (): Expression => {
    let left = both();
    while (peek() === "|") {
      position += 1;
      left = { or: [left, both()] };
    }
    return left;
  };
  const expression = either();
  if (position !== tokens.length) throw new Error(`Unexpected "${peek()}" in "${when}"`);
  return expression;
}

/** The facts an expression names, to check every rule only uses facts that exist. */
export function factsOf(expression: Expression): string[] {
  if ("fact" in expression) return [expression.fact];
  if ("not" in expression) return factsOf(expression.not);
  const [left, right] = "and" in expression ? expression.and : expression.or;
  return [...factsOf(left), ...factsOf(right)];
}

export function holds(expression: Expression, facts: Record<string, boolean>): boolean {
  if ("fact" in expression) return facts[expression.fact] === true;
  if ("not" in expression) return !holds(expression.not, facts);
  if ("and" in expression) return expression.and.every((part) => holds(part, facts));
  return expression.or.some((part) => holds(part, facts));
}

/** Whether a rule's engines include this engine at this version. */
export function appliesTo(engines: string, engine: Engine, version: string): boolean {
  if (engines === "*") return true;
  return engines.split(/\s+/).some((entry) => {
    const [name, range] = entry.split("@");
    if (name !== engine) return false;
    if (!range) return true;
    return range.startsWith("<") ? !atLeast(version, range.slice(1)) : atLeast(version, range);
  });
}

/** A message with each {placeholder} filled from the subject's values. */
export function fill(message: string, values: Subject["values"]): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) return placeholder;
    return typeof value === "number" ? value.toLocaleString("en-US") : value;
  });
}
