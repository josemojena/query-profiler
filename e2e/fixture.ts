import type { Profile, ProfileListItem } from "../src/core/index.js";

const repeated = [1, 2, 3, 4, 5].map((n) => ({
  id: `q_${n + 1}`,
  opId: `op_${n + 1}`,
  sql: `SELECT "id", "total" FROM "Order" WHERE "userId" = $1`,
  params: [n],
  fingerprint: "0a1b2c3d4e5f",
  startMs: 4 + n,
  durationMs: 3.1,
}));

export const PROFILE: Profile = {
  schemaVersion: 1,
  token: "a1b2c3",
  kind: "document",
  request: { method: "GET", url: "/orders" },
  response: { status: 200 },
  startedAt: Date.UTC(2026, 10, 4, 9),
  durationMs: 312,
  framework: { name: "react-router" },
  operations: [
    {
      id: "op_1",
      model: "User",
      action: "findUnique",
      args: { where: { id: 42 } },
      startMs: 1,
      durationMs: 1.4,
      queryIds: ["q_1"],
      origin: [{ file: "/repo/app/routes/orders.tsx", line: 18 }],
    },
    ...repeated.map((query) => ({
      id: query.opId,
      model: "Order",
      action: "findMany",
      startMs: query.startMs,
      durationMs: 3.4,
      queryIds: [query.id],
      origin: [{ file: "/repo/app/order-list.server.ts", line: 31 }],
    })),
  ],
  queries: [
    {
      id: "q_1",
      opId: "op_1",
      sql: `SELECT "id", "email" FROM "User" WHERE "id" = $1`,
      params: [42],
      fingerprint: "ffffffffffff",
      startMs: 1,
      durationMs: 1.2,
    },
    ...repeated,
    {
      id: "q_7",
      sql: `SELECT COUNT(*) FROM "Order" WHERE status = $1`,
      params: ["paid"],
      fingerprint: "eeeeeeeeeeee",
      startMs: 20,
      durationMs: 112.4,
      origin: [{ file: "/repo/app/stats.server.ts", line: 9 }],
    },
  ],
  warnings: [
    { kind: "n+1", fingerprint: "0a1b2c3d4e5f", queryIds: repeated.map((q) => q.id) },
    { kind: "slow", fingerprint: "eeeeeeeeeeee", queryIds: ["q_7"] },
  ],
  summary: { queryCount: 7, dbTimeMs: 48.7, operationCount: 6, errorCount: 0 },
};

export const DATA_REQUEST: Profile = {
  ...PROFILE,
  token: "d4e5f6",
  kind: "data",
  request: { method: "GET", url: "/orders.data" },
  warnings: [],
  queries: PROFILE.queries.slice(0, 1),
  operations: PROFILE.operations.slice(0, 1),
  summary: { queryCount: 1, dbTimeMs: 1.2, operationCount: 1, errorCount: 0 },
};

export function listItem(profile: Profile): ProfileListItem {
  const { operations: _o, queries: _q, warnings, ...rest } = profile;
  return { ...rest, warningCount: warnings.length };
}

export const PROMOTIONS: Profile = {
  ...DATA_REQUEST,
  token: "c0ffee",
  parentToken: PROFILE.token,
  kind: "data",
  request: { method: "GET", url: "/api/promotions" },
};

export const NEXT_PAGE: Profile = {
  ...DATA_REQUEST,
  token: "e1e1e1",
  parentToken: PROFILE.token,
  request: { method: "GET", url: "/orders/7.data" },
};

const { response: _response, ...noResponse } = PROFILE;

/** A seed run with the preload: no request behind it, and past the queries a profile keeps. */
export const SCRIPT: Profile = {
  ...noResponse,
  token: "5eed00",
  kind: "script",
  request: { method: "", url: "prisma/seed.ts" },
  framework: { name: "node" },
  warnings: [...PROFILE.warnings, { kind: "truncated", queryIds: [] }],
  summary: { ...PROFILE.summary, unrecordedQueries: 59_000 },
};

/** Queries a server made between requests, named after the line that started them. */
export const BACKGROUND: Profile = {
  ...SCRIPT,
  token: "bac0f0",
  kind: "background",
  request: { method: "", url: "app/jobs/cleanup.ts:9" },
  warnings: [],
  summary: { queryCount: 1, dbTimeMs: 1.2, operationCount: 1, errorCount: 0 },
};
