import { describe, expect, it } from "vitest";
import type { ProfileListItem } from "../../src/core/index.js";
import { mergeProfiles } from "../../src/ui/live.js";

const item = (
  token: string,
  startedAt: number,
  durationMs = 10,
  status = 200,
): ProfileListItem => ({
  schemaVersion: 1,
  token,
  kind: "document",
  request: { method: "GET", url: `/${token}` },
  response: { status },
  startedAt,
  durationMs,
  framework: { name: "react-router" },
  summary: { queryCount: 0, dbTimeMs: 0, operationCount: 0, errorCount: 0 },
  warningCount: 0,
});

const tokens = (items: ProfileListItem[]) => items.map((profile) => profile.token);

describe("mergeProfiles", () => {
  it("puts what finished last first, whichever list it came in", () => {
    const merged = mergeProfiles(
      [item("aaaaaa", 1_000), item("cccccc", 3_000)],
      [item("bbbbbb", 2_000)],
    );
    expect(tokens(merged)).toEqual(["cccccc", "bbbbbb", "aaaaaa"]);
  });

  it("orders by when a request finished, not when it started", () => {
    const merged = mergeProfiles([item("aaaaaa", 1_000, 5_000)], [item("bbbbbb", 2_000, 10)]);
    expect(tokens(merged)).toEqual(["aaaaaa", "bbbbbb"]);
  });

  it("keeps each profile once, as the newer list has it", () => {
    const merged = mergeProfiles([item("aaaaaa", 1_000, 10, 500)], [item("aaaaaa", 1_000)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.response?.status).toBe(500);
  });

  it("puts the newer list first when two finished at the same time", () => {
    const merged = mergeProfiles([item("newone", 1_000)], [item("oldone", 1_000)]);
    expect(tokens(merged)).toEqual(["newone", "oldone"]);
  });

  it("keeps only as many as asked", () => {
    const merged = mergeProfiles(
      [item("aaaaaa", 1_000), item("bbbbbb", 2_000)],
      [item("cccccc", 3_000)],
      2,
    );
    expect(tokens(merged)).toEqual(["cccccc", "bbbbbb"]);
  });
});
