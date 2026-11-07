import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where paths are shown from: the repository root, or the working directory. */
export function projectRoot(): string {
  for (let dir = process.cwd(); dir !== dirname(dir); dir = dirname(dir))
    if (existsSync(join(dir, ".git"))) return dir;
  return process.cwd();
}
