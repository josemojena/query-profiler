import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/core/sanitize.js";

describe("sanitize", () => {
  it("redacts secrets by key, at any depth", () => {
    expect(
      sanitize({
        where: { email: "a@example.test", password: "x" },
        data: { apiKey: "k", api_key: "k" },
      }),
    ).toEqual({
      where: { email: "a@example.test", password: "[redacted]" },
      data: { apiKey: "[redacted]", api_key: "[redacted]" },
    });
  });

  it("cuts long strings and turns what JSON cannot hold into text", () => {
    const long = sanitize("x".repeat(3000)) as string;
    expect(long).toHaveLength(2049);
    expect(sanitize([10n, new Date("2026-11-04T09:00:00Z"), Buffer.from("abc")])).toEqual([
      "10",
      "2026-11-04T09:00:00.000Z",
      "<3 bytes>",
    ]);
  });

  it("stops at a fixed depth", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 12; i += 1) deep = { a: deep };
    expect(JSON.stringify(sanitize(deep))).toBe(`${'{"a":'.repeat(10)}"…"${"}".repeat(10)}`);
  });
});
