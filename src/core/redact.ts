/** Keys whose values are not shown. */
export const SECRET = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;
export const REDACTED = "[redacted]";

const COMPARED = /["`]?([A-Za-z_]\w*)["`]?\s*=\s*\$(\d+)/g;
// A '…' string, or a ? placeholder outside one.
const PLACEHOLDER = /('(?:[^']|'')*')|\?/g;
const INSERT = /\binsert\s+into\s+[^(]+\(([^)]*)\)\s*values\s*/i;
const TUPLE = /\(([^()]*)\)/g;

/** The string values under a secret-looking key, anywhere in `value`. */
export function secretValues(value: unknown, found = new Set<string>(), key = ""): Set<string> {
  if (typeof value === "string" && SECRET.test(key)) found.add(value);
  else if (Array.isArray(value)) for (const item of value) secretValues(item, found, key);
  else if (value && typeof value === "object" && !(value instanceof Date))
    for (const [name, item] of Object.entries(value)) secretValues(item, found, name);
  return found;
}

/**
 * The parameters with the secrets hidden: those equal to a value the operation passed under a
 * secret-looking key, and those the SQL compares with or writes to a column named like one.
 */
export function redactParams(sql: string, params: unknown[], secrets: Set<string>): unknown[] {
  const hidden = secretPositions(numbered(sql));
  return params.map((param, index) =>
    hidden.has(index + 1) || (typeof param === "string" && secrets.has(param)) ? REDACTED : param,
  );
}

/** `$n` positions the SQL binds to a secret-looking column. */
function secretPositions(sql: string): Set<number> {
  const positions = new Set<number>();
  for (const [, column, position] of sql.matchAll(COMPARED))
    if (SECRET.test(column!)) positions.add(Number(position));
  const insert = INSERT.exec(sql);
  if (insert) {
    const columns = insert[1]!.split(",").map((column) => column.trim().replace(/["`]/g, ""));
    for (const [, tuple] of sql.slice(insert.index + insert[0].length).matchAll(TUPLE))
      tuple!.split(",").forEach((value, index) => {
        const position = /^\s*\$(\d+)\s*$/.exec(value)?.[1];
        if (position && SECRET.test(columns[index] ?? "")) positions.add(Number(position));
      });
  }
  return positions;
}

/** MySQL and SQLite bind with ?, not $1: numbered, both read the same. */
function numbered(sql: string): string {
  if (/\$\d+/.test(sql)) return sql;
  let position = 0;
  return sql.replace(PLACEHOLDER, (placeholder, quoted?: string) => quoted ?? `$${++position}`);
}
