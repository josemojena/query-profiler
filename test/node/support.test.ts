import { expect, it } from "vitest";
import { addsConditions } from "../../src/node/support.js";

it("takes Node 22.19+ and 24.5+, where a module hook's conditions reach import and require()", () => {
  expect(
    ["22.19.0", "22.23.4", "24.5.0", "24.22.2", "25.0.0", "26.10.0"].map(addsConditions),
  ).toEqual([true, true, true, true, true, true]);
  expect(
    ["20.19.0", "22.15.0", "22.18.0", "23.11.0", "24.0.0", "24.4.0"].map(addsConditions),
  ).toEqual([false, false, false, false, false, false]);
});
