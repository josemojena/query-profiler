import { expect, it } from "vitest";
import { readCatalog } from "../../src/analysis/catalog.js";
import type { RunSql } from "../../src/core/index.js";

/** One connection, as a rolled back transaction has: a query sent while another runs fails. */
function oneConnection(): RunSql {
  let busy = false;
  return async () => {
    if (busy) throw new Error("the connection is already running a query");
    busy = true;
    await new Promise((resolve) => setImmediate(resolve));
    busy = false;
    return { columns: [], rows: [] };
  };
}

it("reads the catalog one query at a time, as one transaction's connection takes them", async () => {
  for (const engine of ["postgres", "mysql", "mariadb", "sqlite"] as const)
    await expect(readCatalog(oneConnection(), engine, [{ name: "Post" }])).resolves.toEqual([]);
});
