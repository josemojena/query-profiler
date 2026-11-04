import { describe, expect, it } from "vitest";
import { editorLink, escape, ms, runnableSql, shortPath, statusTone } from "../../src/ui/format.js";

describe("format", () => {
  it("escapes what goes into HTML", () => {
    expect(escape(`<img src=x onerror="a('b')">&`)).toBe(
      "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
    );
  });

  it("shows milliseconds with one decimal below 100", () => {
    expect([ms(3.14159), ms(112.4), ms(undefined)]).toEqual(["3.1 ms", "112 ms", "–"]);
  });

  it("shows paths from the project root", () => {
    expect(shortPath("/repo/apps/web/app/x.ts", "/repo")).toBe("apps/web/app/x.ts");
    expect(shortPath("/elsewhere/x.ts", "/repo")).toBe("/elsewhere/x.ts");
  });

  it("links to the editor at the line", () => {
    const frame = { file: "/repo/app/a b.ts", line: 12, column: 3 };
    expect(editorLink(frame, "vscode")).toBe("vscode://file/repo/app/a%20b.ts:12:3");
    expect(editorLink(frame, "cursor")).toBe("cursor://file/repo/app/a%20b.ts:12:3");
    expect(editorLink(frame, "none")).toBeUndefined();
  });

  it("puts the parameters back into the statement", () => {
    expect(
      runnableSql({
        sql: 'SELECT * FROM "User" WHERE name = $1 AND age > $2 AND active = $3 AND meta = $4 AND x = $5 AND y = $10',
        params: ["O'Brien", 21, true, { a: 1 }, null],
      }),
    ).toBe(
      `SELECT * FROM "User" WHERE name = 'O''Brien' AND age > 21 AND active = true AND meta = '{"a":1}' AND x = NULL AND y = $10`,
    );
  });

  it("colours statuses", () => {
    expect([200, 302, 404, 500, undefined].map(statusTone)).toEqual([
      "ok",
      "ok",
      "warn",
      "bad",
      "muted",
    ]);
  });
});
