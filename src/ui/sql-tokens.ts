/**
 * SQL split into tokens for every engine's quoting and parameters: shared by the layout in the
 * browser and by the analysis on the server, so it imports nothing.
 */

// Whitespace, a 'string', a "name" or `name`, a comment, $1 or ?, a word, ( ) , and anything else,
// in that order.
export const PATTERN =
  /(\s+)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?|`(?:[^`]|``)*`?)|(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(\$\d+|\?)|([A-Za-z_][\w$]*)|(\()|(\))|(,)|([^\s'"`(),A-Za-z_$?]+|\$)/g;

export type Kind =
  | "string"
  | "name"
  | "comment"
  | "param"
  | "word"
  | "open"
  | "close"
  | "comma"
  | "other";

export interface Token {
  kind: Kind;
  text: string;
  upper: string;
  /** Whitespace came before it in the SQL as written. */
  spaced: boolean;
}

export interface Range {
  from: number;
  to: number;
}

export const KINDS: Kind[] = [
  "string",
  "name",
  "comment",
  "param",
  "word",
  "open",
  "close",
  "comma",
];

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let spaced = false;
  for (const match of sql.matchAll(PATTERN)) {
    if (match[1]) {
      spaced = true;
      continue;
    }
    const kind = KINDS.find((_, index) => match[index + 2] !== undefined) ?? "other";
    const text = match[0];
    tokens.push({ kind, text, upper: kind === "word" ? text.toUpperCase() : text, spaced });
    spaced = false;
  }
  return tokens;
}

/** The index of each opening parenthesis's closing one. */
export function matchParens(tokens: readonly { kind: string }[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind === "open") open.push(index);
    else if (token.kind === "close" && open.length) pairs.set(open.pop()!, index);
  });
  return pairs;
}
