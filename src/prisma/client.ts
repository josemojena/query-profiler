import { captureOrigin, runInScope, type StackFrame } from "../core/index.js";
import { profilerExtension } from "./extension.js";

interface Client {
  $extends(extension: typeof profilerExtension): object;
}

type Fn = (...args: unknown[]) => unknown;

const RAW = new Set([
  "$queryRaw",
  "$executeRaw",
  "$queryRawUnsafe",
  "$executeRawUnsafe",
  "$queryRawTyped",
]);
const DEFERRED = ["then", "catch", "finally", "requestTransaction"];

/**
 * The Prisma client with the profiler: each operation, the SQL it ran and the line of your code
 * that called it. Pass it a client built with `withProfiler()`.
 */
export function profilePrisma<T extends Client>(client: T): Omit<T, "$on"> {
  return callSites(client.$extends(profilerExtension)) as Omit<T, "$on">;
}

// Prisma runs a call when it is awaited, not when it is made, and Node before 26 loses the
// caller across that gap: the line is taken when the call is made, and travels with it.
function callSites<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof key !== "string") return value;
      if (key === "$transaction" && typeof value === "function")
        return transaction(target, value as Fn);
      if (RAW.has(key) && typeof value === "function") return traced(target, value as Fn);
      if (!key.startsWith("$") && !key.startsWith("_") && typeof value === "object" && value)
        return model(value);
      return value;
    },
  });
}

function model(delegate: object): object {
  return new Proxy(delegate, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function" ? traced(target, value as Fn) : value;
    },
  });
}

function traced(owner: object, fn: Fn): Fn {
  return (...args) => carry(fn.apply(owner, args), captureOrigin());
}

/** Runs the deferred work of a Prisma call with the line it was made from. */
function carry<T>(result: T, call: StackFrame[]): T {
  if (!result || typeof result !== "object") return result;
  const deferred = result as Record<string, unknown>;
  for (const name of DEFERRED) {
    const method = deferred[name];
    if (typeof method === "function")
      deferred[name] = (...args: unknown[]) =>
        runInScope({ call }, () => (method as Fn).apply(result, args));
  }
  return result;
}

/** An interactive transaction hands its callback a client of its own: that one is traced too. */
function transaction(owner: object, fn: Fn): Fn {
  return (first, ...rest) =>
    fn.apply(owner, [
      typeof first === "function" ? (tx: object) => (first as Fn)(callSites(tx)) : first,
      ...rest,
    ]);
}
