import { createHash } from "node:crypto";

/** The shape of a statement, without literals, placeholders or comments. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/\$\d+/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, "(?)")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint(sql: string): string {
  return createHash("sha1").update(normalizeSql(sql)).digest("hex").slice(0, 12);
}
