import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { StackFrame } from "./profile.js";

const FRAME = /^\s*at (?:(?:async )?(.*?) \()?(.+?):(\d+):(\d+)\)?$/;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..") + sep;
// Built code, or its source when a stack trace is source-mapped.
const OWN = [`${ROOT}dist${sep}`, `${ROOT}src${sep}`];
const isOwn = (file: string) => OWN.some((dir) => file.startsWith(dir));
const SKIP = [/^node:/, /[\\/]node_modules[\\/]/, /^internal[\\/]/];

/** The first frames of the caller that belong to the app. */
export function captureOrigin(limit = 5): StackFrame[] {
  const previous = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = previous;
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const file = match[2]!.replace(/^file:\/\//, "");
    if (isOwn(file) || SKIP.some((pattern) => pattern.test(file))) continue;
    frames.push({
      file,
      line: Number(match[3]),
      column: Number(match[4]),
      fn: match[1] || undefined,
    });
    if (frames.length >= limit) break;
  }
  return frames;
}
