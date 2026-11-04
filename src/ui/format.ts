import type { QueryRecord, StackFrame } from "../core/index.js";

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escape = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]!);

export const ms = (value: number | undefined) =>
  value === undefined ? "–" : `${value >= 100 ? Math.round(value) : value.toFixed(1)} ms`;

export function shortPath(file: string, root: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

export type Editor = "vscode" | "cursor" | "none";

export function editorLink(frame: StackFrame, editor: Editor): string | undefined {
  if (editor === "none") return undefined;
  return `${editor}://file${encodeURI(frame.file)}:${frame.line}:${frame.column ?? 1}`;
}

/** The statement with its parameters in place, to paste into a SQL console. */
export function runnableSql(query: Pick<QueryRecord, "sql" | "params">): string {
  return query.sql.replace(/\$(\d+)/g, (placeholder, index: string) => {
    const index0 = Number(index) - 1;
    return index0 < query.params.length ? literal(query.params[index0]) : placeholder;
  });
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

export const statusTone = (status: number | undefined) =>
  status === undefined ? "muted" : status >= 500 ? "bad" : status >= 400 ? "warn" : "ok";
