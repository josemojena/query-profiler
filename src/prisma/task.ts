import { enabled, endProfile, runWithProfile, serveOutside, startProfile } from "../core/index.js";

/**
 * Runs `task` in a profile of its own, named `name`, as a request has: one per job of a queue
 * worker, one per run of a cron. Outside development, it only runs it.
 */
export async function profileTask<T>(name: string, task: () => T | PromiseLike<T>): Promise<T> {
  if (!enabled()) return task();
  serveOutside();
  const active = startProfile({ method: "", url: name, kind: "task" }, { name: "node" });
  try {
    // Awaited inside the profile: a Prisma call only runs once awaited, and must run in it.
    return await runWithProfile(active, async () => task());
  } finally {
    endProfile(active);
  }
}
