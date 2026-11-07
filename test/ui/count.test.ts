import { expect, it } from "vitest";
import { countedKinds } from "../../src/ui/count.js";

it("says what the stored profiles are: requests together, then each kind of work", () => {
  expect(countedKinds({ document: 9, data: 2, api: 1 })).toBe("12 requests");
  expect(countedKinds({ document: 1, script: 2, task: 1 })).toBe("1 request, 2 scripts and 1 task");
  expect(countedKinds({ script: 1 })).toBe("1 script");
  expect(countedKinds({ background: 3, startup: 1 })).toBe("1 startup and 3 background runs");
  expect(countedKinds({})).toBe("0 requests");
});
