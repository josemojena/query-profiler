import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The folders query-profiler is installed in: next to this module, and as the app finds it, since a
 * bundler (Turbopack, webpack) moves this module and rewrites import.meta.url.
 */
export const PACKAGE_ROOTS = [
  ...new Set([
    resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
    ...[import.meta.url, join(process.cwd(), "package.json")].flatMap(
      (from) => rootFrom(from) ?? [],
    ),
  ]),
];

function rootFrom(from: string): string | undefined {
  try {
    return resolve(dirname(createRequire(from).resolve("query-profiler/ui")), "../..");
  } catch {
    return undefined;
  }
}
