import { findSourceMap } from "node:module";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_ROOTS } from "./installed.js";
import type { StackFrame } from "./profile.js";

const FRAME = /^\s*at (?:(?:async )?(.*?) \()?(.+?):(\d+):(\d+)\)?$/;
// Built code, or its source when a stack trace is source-mapped.
const OWN = PACKAGE_ROOTS.flatMap((root) => [`${root}${sep}dist${sep}`, `${root}${sep}src${sep}`]);
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
    const frame = original({
      file: match[2]!.replace(/^file:\/\//, ""),
      line: Number(match[3]),
      column: Number(match[4]),
      fn: match[1] || undefined,
    });
    if (isOwn(frame.file) || SKIP.some((pattern) => pattern.test(frame.file))) continue;
    frames.push(frame);
    if (frames.length >= limit) break;
  }
  return frames;
}

// A built chunk (Next.js, a bundle) shows in the stack as itself when the framework formats stack
// traces: its source map, which Node keeps with --enable-source-maps, leads to the app's file. A
// file compiled in place (tsx) maps to itself: its line is already the source's.
function original(frame: StackFrame): StackFrame {
  const origin = findSourceMap(frame.file)?.findOrigin(frame.line, frame.column ?? 1);
  if (!origin || !("fileName" in origin)) return frame;
  const file = origin.fileName.startsWith("file:")
    ? fileURLToPath(origin.fileName)
    : origin.fileName;
  if (file === frame.file) return frame;
  return { file, line: origin.lineNumber, column: origin.columnNumber, fn: frame.fn };
}
