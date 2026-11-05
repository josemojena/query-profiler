import { escape } from "./format.js";

// About what fits in the SQL column of the bar and of the profiler page.
const WIDTH = 50;
const INDENT = "  ";
// Whitespace, a 'string', a "name", a comment, $1, a word, ( ) , and anything else, in that order.
const PATTERN =
  /(\s+)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(\$\d+)|([A-Za-z_][\w$]*)|(\()|(\))|(,)|([^\s'"(),A-Za-z_$]+|\$)/g;
// Dollar-quoted bodies ($$ … $$) keep their own layout: left as written. So is SQL with a line
// comment, which ends at its line: moving what follows it could comment that out.
const DOLLAR_QUOTE = /\$[A-Za-z_]*\$/;
const LISTS = new Set(["SELECT", "RETURNING", "SET", "GROUP BY", "ORDER BY"]);
const CONDITIONS = new Set(["WHERE", "HAVING"]);
const JOIN_WORDS = new Set(["NATURAL", "LEFT", "RIGHT", "FULL", "INNER", "CROSS", "OUTER"]);
const KEYWORDS = new Set(
  `SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN LEFT RIGHT INNER OUTER FULL CROSS NATURAL
  LATERAL GROUP ORDER BY HAVING LIMIT OFFSET FETCH INSERT INTO VALUES UPDATE SET DELETE RETURNING
  UNION INTERSECT EXCEPT ALL DISTINCT CASE WHEN THEN ELSE END EXISTS BETWEEN LIKE ILIKE ASC DESC
  NULLS FIRST LAST WITH TRUE FALSE CONFLICT DO NOTHING BEGIN COMMIT ROLLBACK SAVEPOINT RELEASE FOR
  SHARE ANY`.split(/\s+/),
);

type Kind = "string" | "name" | "comment" | "param" | "word" | "open" | "close" | "comma" | "other";

interface Token {
  kind: Kind;
  text: string;
  upper: string;
  /** Whitespace came before it in the SQL as written. */
  spaced: boolean;
}

interface Range {
  from: number;
  to: number;
}

const KINDS: Kind[] = ["string", "name", "comment", "param", "word", "open", "close", "comma"];

function tokenize(sql: string): Token[] {
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
function matchParens(tokens: Token[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind === "open") open.push(index);
    else if (token.kind === "close" && open.length) pairs.set(open.pop()!, index);
  });
  return pairs;
}

/**
 * The statement laid out over lines: one clause per line, a long list one item per line, a long
 * condition one AND or OR per line, subqueries indented. Only whitespace changes, and never inside
 * strings, quoted names or comments, so the SQL does exactly the same.
 */
export function formatSql(sql: string): string {
  const tokens = tokenize(sql);
  const lineComment = tokens.some(
    (token) => token.kind === "comment" && token.text.startsWith("--"),
  );
  if (lineComment || DOLLAR_QUOTE.test(sql)) return sql.trim();
  const pairs = matchParens(tokens);
  const upper = (index: number) => tokens[index]?.upper ?? "";
  const pad = (depth: number) => INDENT.repeat(depth);

  // Past a parenthesized group, so its contents never split the level around it.
  const step = (index: number) => (pairs.get(index) ?? index) + 1;

  // How many words start a clause here: 0 if none does.
  const clauseAt = (index: number): number => {
    const word = upper(index);
    const previous = upper(index - 1);
    const next = upper(index + 1);
    if (tokens[index]?.kind !== "word") return 0;
    switch (word) {
      case "SELECT":
      case "WHERE":
      case "HAVING":
      case "LIMIT":
      case "OFFSET":
      case "FETCH":
      case "VALUES":
      case "RETURNING":
      case "WITH":
      case "SET":
        return 1;
      case "FROM":
        if (previous === "DELETE") return 0;
        // a IS [NOT] DISTINCT FROM b compares, it does not start a clause.
        return previous === "DISTINCT" && ["IS", "NOT"].includes(upper(index - 2)) ? 0 : 1;
      case "GROUP":
      case "ORDER":
        return next === "BY" ? 2 : 0;
      case "UPDATE":
        return previous === "DO" || previous === "FOR" ? 0 : 1;
      case "DELETE":
        return next === "FROM" ? 2 : 1;
      case "INSERT":
        return next === "INTO" ? 2 : 1;
      case "UNION":
      case "INTERSECT":
      case "EXCEPT":
        return next === "ALL" || next === "DISTINCT" ? 2 : 1;
      case "ON":
        return next === "CONFLICT" ? 2 : 0;
      default: {
        if (word !== "JOIN" && !JOIN_WORDS.has(word)) return 0;
        let end = index;
        while (JOIN_WORDS.has(upper(end))) end += 1;
        return upper(end) === "JOIN" ? end - index + 1 : 0;
      }
    }
  };

  // A run of tokens on one line, with the spacing it was written with, subqueries expanded.
  const inline = ({ from, to }: Range, depth: number): string => {
    let out = "";
    for (let index = from; index < to; index += 1) {
      const token = tokens[index]!;
      const space = out && token.spaced ? " " : "";
      const close = pairs.get(index);
      if (
        token.kind === "open" &&
        close !== undefined &&
        ["SELECT", "WITH"].includes(upper(index + 1))
      ) {
        out += `${space}(\n${statement({ from: index + 1, to: close }, depth + 1)}\n${pad(depth)})`;
        index = close;
      } else out += space + token.text;
    }
    return out;
  };

  const split = ({ from, to }: Range, at: (index: number) => boolean): Range[] => {
    const parts: Range[] = [];
    let start = from;
    for (let index = from; index < to; index = step(index))
      if (index > start && at(index)) {
        parts.push({ from: start, to: index });
        start = index;
      }
    parts.push({ from: start, to });
    return parts;
  };

  const list = (head: string, body: Range, depth: number): string => {
    let from = body.from;
    // SELECT DISTINCT [ON (…)] belongs with SELECT, not with its first column.
    if (head === "SELECT" && upper(from) === "DISTINCT") {
      from += 1;
      if (upper(from) === "ON" && tokens[from + 1]?.kind === "open") from = step(from + 1);
      head = inline({ from: body.from - 1, to: from }, depth);
    }
    const items = split({ from, to: body.to }, (index) => tokens[index - 1]?.kind === "comma")
      .map((range) => inline(range, depth + 1))
      .map((item) => item.replace(/,$/, ""));
    const line = `${head} ${items.join(", ")}`;
    if (items.length < 2 || (!line.includes("\n") && pad(depth).length + line.length <= WIDTH))
      return pad(depth) + line;
    return `${pad(depth)}${head}\n${items.map((item) => pad(depth + 1) + item).join(",\n")}`;
  };

  const conditions = (head: string, body: Range, depth: number): string => {
    const flat = `${head} ${inline(body, depth)}`;
    // Prisma wraps a whole condition in parentheses: lay out what is inside them.
    const wrapped = tokens[body.from]?.kind === "open" && pairs.get(body.from) === body.to - 1;
    const inner = wrapped ? { from: body.from + 1, to: body.to - 1 } : body;
    let between = false;
    const parts = split(inner, (index) => {
      const word = upper(index);
      if (word === "BETWEEN") between = true;
      if (word !== "AND" && word !== "OR") return false;
      if (word === "AND" && between) return (between = false);
      return true;
    });
    if (parts.length < 2 || (!flat.includes("\n") && pad(depth).length + flat.length <= WIDTH))
      return pad(depth) + flat;
    const lines = parts.map((part) => pad(depth + 1) + inline(part, depth + 1));
    if (wrapped) return `${pad(depth)}${head} (\n${lines.join("\n")}\n${pad(depth)})`;
    return `${pad(depth)}${head} ${lines.join("\n").trimStart()}`;
  };

  // One clause per line, each laid out by its kind.
  function statement({ from, to }: Range, depth: number): string {
    const starts: number[] = [];
    for (let index = from; index < to; index = step(index)) {
      const words = clauseAt(index);
      if (words) {
        starts.push(index);
        index += words - 1;
      }
    }
    if (starts[0] !== from) starts.unshift(from);
    return starts
      .map((start, position) => {
        const end = starts[position + 1] ?? to;
        const words = clauseAt(start);
        const head = tokens
          .slice(start, start + words)
          .map((token) => token.text)
          .join(" ");
        const body = { from: start + words, to: end };
        const key = head.toUpperCase();
        if (LISTS.has(key) && body.from < body.to) return list(head, body, depth);
        if (CONDITIONS.has(key) && body.from < body.to) return conditions(head, body, depth);
        return pad(depth) + [head, inline(body, depth)].filter(Boolean).join(" ");
      })
      .join("\n");
  }

  return statement({ from: 0, to: tokens.length }, 0);
}

/** SQL as HTML, its keywords, strings, parameters and comments marked for colour. */
export function highlightSql(sql: string): string {
  let html = "";
  for (const match of sql.matchAll(PATTERN)) {
    const text = escape(match[0]);
    const kind = match[1] ? undefined : KINDS.find((_, index) => match[index + 2] !== undefined);
    if (kind === "word" && KEYWORDS.has(match[0].toUpperCase()))
      html += `<span class="kw">${text}</span>`;
    else if (kind === "string") html += `<span class="str">${text}</span>`;
    else if (kind === "param") html += `<span class="param">${text}</span>`;
    else if (kind === "comment") html += `<span class="cm">${text}</span>`;
    else html += text;
  }
  return html;
}
