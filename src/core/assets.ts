import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const UI_FILE = /^\/ui\/([a-z-]+\.js)$/;
// A bundler (Turbopack) rewrites import.meta.url, so the package is also looked up from the app.
const UI_DIR = [import.meta.url, join(process.cwd(), "package.json")]
  .map((from) => uiDirFrom(from))
  .find((dir) => dir && existsSync(join(dir, "index.js")));

/**
 * The bar and the page's code, for servers without Vite. `/ui.js` redirects to the entry, so the
 * browser resolves the entry's relative imports under `/ui/`.
 */
export function uiAsset(base: string, path: string): Response | undefined {
  if (path === "/ui.js")
    return new Response(null, { status: 302, headers: { Location: `${base}/ui/index.js` } });
  const name = UI_FILE.exec(path)?.[1];
  const file = name && UI_DIR && join(UI_DIR, name);
  if (!file || !existsSync(file)) return undefined;
  return new Response(readFileSync(file), {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function uiDirFrom(from: string): string | undefined {
  try {
    return dirname(createRequire(from).resolve("query-profiler/ui"));
  } catch {
    return undefined;
  }
}
