import { describe, expect, it } from "vitest";
import { redactParams, secretValues } from "../../src/core/redact.js";

const none = new Set<string>();

describe("redactParams", () => {
  it("hides the parameters compared with or set to a secret-looking column", () => {
    expect(
      redactParams(
        'SELECT "id" FROM "public"."User" WHERE ("public"."User"."email" = $1 AND "public"."User"."passwordHash" = $2)',
        ["a@example.test", "hash"],
        none,
      ),
    ).toEqual(["a@example.test", "[redacted]"]);
    expect(
      redactParams('UPDATE "User" SET "api_key" = $1 WHERE id = $2', ["key", 3], none),
    ).toEqual(["[redacted]", 3]);
  });

  it("hides the values inserted into a secret-looking column, in every row", () => {
    expect(
      redactParams(
        'INSERT INTO "public"."User" ("email","password") VALUES ($1,$2),($3,$4) RETURNING "id"',
        ["a@example.test", "first", "b@example.test", "second"],
        none,
      ),
    ).toEqual(["a@example.test", "[redacted]", "b@example.test", "[redacted]"]);
  });

  it("reads MySQL and SQLite statements, which bind with ? and quote with backticks", () => {
    expect(
      redactParams(
        "INSERT INTO `User` (`email`,`password`) VALUES (?,?)",
        ["a@example.test", "hunter2"],
        none,
      ),
    ).toEqual(["a@example.test", "[redacted]"]);
    expect(
      redactParams(
        "SELECT `User`.`id` FROM `User` WHERE `User`.`email` LIKE CONCAT('%', ?, '%') AND `User`.`token` = ? LIMIT ?",
        ["x", "t0ken", "5"],
        none,
      ),
    ).toEqual(["x", "[redacted]", "5"]);
    expect(
      redactParams("SELECT 1 FROM t WHERE note = 'what?' AND secret = ?", ["s3cret"], none),
    ).toEqual(["[redacted]"]);
  });

  it("hides the values the operation passed under a secret-looking key", () => {
    expect(redactParams("SELECT $1, $2", ["visible", "s3cret"], new Set(["s3cret"]))).toEqual([
      "visible",
      "[redacted]",
    ]);
  });

  it("leaves everything else as it is", () => {
    const params = ["paid", 10, null];
    expect(
      redactParams('SELECT * FROM "Order" WHERE "status" = $1 LIMIT $2', params, none),
    ).toEqual(params);
  });
});

describe("secretValues", () => {
  it("finds the strings under secret-looking keys, however deep", () => {
    expect(
      secretValues({
        data: { email: "a@example.test", password: "p", profile: { apiKey: "k" } },
        where: { tokens: ["t1"] },
      }),
    ).toEqual(new Set(["p", "k", "t1"]));
  });
});
