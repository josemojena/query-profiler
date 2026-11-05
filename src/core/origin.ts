import { readFileSync } from "node:fs";
import { findSourceMap, SourceMap } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_ROOTS } from "./installed.js";
import type { StackFrame } from "./profile.js";

const FRAME = /^\s*at (?:(?:async )?(.*?) \()?(.+?):(\d+):(\d+)\)?$/;
// Built code, or its source when a stack trace is source-mapped.
const OWN = PACKAGE_ROOTS.flatMap((root) => [`${root}${sep}dist${sep}`, `${root}${sep}src${sep}`]);
const isOwn = (file: string) => OWN.some((dir) => file.startsWith(dir));
const SKIP = [/^node:/, /[\\/]node_modules[\\/]/, /^internal[\\/]/];
const MAPPING_URL = /\/\/# sourceMappingURL=(\S+)\s*$/;
const readMaps = new Map<string, SourceMap | undefined>();

type Payload = ConstructorParameters<typeof SourceMap>[0];

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

// A built file (a bundle, tsc's output) shows in the stack as itself unless Node maps stack traces:
// its source map leads to the app's file. A file compiled in place (tsx) maps to itself: its line
// is already the source's.
function original(frame: StackFrame): StackFrame {
  const origin = sourceMapOf(frame.file)?.findOrigin(frame.line, frame.column ?? 1);
  if (!origin || !("fileName" in origin)) return frame;
  const file = origin.fileName.startsWith("file:")
    ? fileURLToPath(origin.fileName)
    : origin.fileName;
  if (file === frame.file) return frame;
  return { file, line: origin.lineNumber, column: origin.columnNumber, fn: frame.fn };
}

// Node keeps a file's source map only with --enable-source-maps. Without it, read the map an app
// file points to, once; never a dependency's, which is skipped anyway and can be huge.
function sourceMapOf(file: string): SourceMap | undefined {
  const kept = findSourceMap(file);
  if (kept || isOwn(file) || SKIP.some((pattern) => pattern.test(file))) return kept;
  if (!readMaps.has(file)) readMaps.set(file, readSourceMap(file));
  return readMaps.get(file);
}

function readSourceMap(file: string): SourceMap | undefined {
  try {
    const url = MAPPING_URL.exec(readFileSync(file, "utf8"))?.[1];
    if (!url) return undefined;
    const inline = url.startsWith("data:");
    const path = inline ? file : resolve(dirname(file), url);
    const payload = JSON.parse(
      inline
        ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString("utf8")
        : readFileSync(path, "utf8"),
    ) as Payload;
    // Sources are relative to the map, as Node resolves them when it loads a map itself.
    const root = resolve(dirname(path), payload.sourceRoot ?? "");
    payload.sources = payload.sources.map((source) =>
      source.startsWith("file:") ? fileURLToPath(source) : resolve(root, source),
    );
    return new SourceMap(payload);
  } catch {
    return undefined;
  }
}
