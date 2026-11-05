import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOTS } from "./installed.js";

const UI_FILE = /^\/ui\/([a-z-]+\.js)$/;
const UI_DIR = PACKAGE_ROOTS.map((root) => join(root, "dist", "ui")).find((dir) =>
  existsSync(join(dir, "index.js")),
);

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
