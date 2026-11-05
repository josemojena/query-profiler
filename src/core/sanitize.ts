import { REDACTED, SECRET } from "./redact.js";

const MAX_STRING = 2048;
const MAX_DEPTH = 10;

/** A copy safe to keep and show: secrets by key name redacted, long strings cut. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET.test(key) ? REDACTED : sanitize(item, depth + 1),
    ]),
  );
}
