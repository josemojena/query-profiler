import { describe, expect, it } from "vitest";
import { captureOrigin } from "../../src/core/origin.js";

function fromTheApp() {
  return captureOrigin();
}

describe("captureOrigin", () => {
  it("starts at the caller, skipping the profiler itself, node internals and node_modules", () => {
    const [first, ...rest] = fromTheApp();
    expect(first).toMatchObject({ fn: "fromTheApp", line: 5 });
    expect(first!.file).toMatch(/test[\\/]core[\\/]origin\.test\.ts$/);
    expect([first, ...rest].every((frame) => !/node_modules|^node:/.test(frame!.file))).toBe(true);
  });

  it("keeps at most the frames asked for", () => {
    expect(captureOrigin(1)).toHaveLength(1);
  });
});
