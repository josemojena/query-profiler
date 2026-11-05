import { AsyncLocalStorage } from "node:async_hooks";
import type { Scope } from "./context.js";
import type { Profile } from "./profile.js";

export interface State {
  als: AsyncLocalStorage<Scope>;
  profiles: Profile[];
  listeners: Set<(profile: Profile) => void>;
  /** Optional: a state made by an older copy of the package in the same process has none. */
  clearListeners?: Set<() => void>;
  limit: number;
}

// Dev servers and bundlers may load this module more than once (Vite's SSR runner
// next to Node, HMR); a single store on globalThis keeps every copy on the same context.
const KEY = Symbol.for("query-profiler");

export function state(): State {
  const global = globalThis as { [KEY]?: State };
  global[KEY] ??= { als: new AsyncLocalStorage(), profiles: [], listeners: new Set(), limit: 100 };
  return global[KEY];
}
