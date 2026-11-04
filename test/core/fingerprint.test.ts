import { describe, expect, it } from "vitest";
import { fingerprint, normalizeSql } from "../../src/core/fingerprint.js";

describe("normalizeSql", () => {
  it("drops literals, placeholders, comments and list lengths", () => {
    expect(
      normalizeSql(`SELECT "id" FROM "User" /*query_profiler='op_1'*/
        WHERE "id" IN ($1, $2, $3) AND "age" > 21 AND "name" = 'O''Brien' -- trailing`),
    ).toBe(`SELECT "id" FROM "User" WHERE "id" IN (?) AND "age" > ? AND "name" = ?`);
  });

  it("keeps digits that are part of an identifier", () => {
    expect(normalizeSql(`SELECT col_1 FROM t2 WHERE x = 3`)).toBe(
      `SELECT col_1 FROM t2 WHERE x = ?`,
    );
  });
});

describe("fingerprint", () => {
  it("is the same for the same shape and different otherwise", () => {
    const a = fingerprint(`SELECT * FROM "Order" WHERE "userId" = $1`);
    expect(fingerprint(`SELECT * FROM "Order"   WHERE "userId" = $7`)).toBe(a);
    expect(fingerprint(`SELECT * FROM "Order" WHERE "status" = $1`)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});
