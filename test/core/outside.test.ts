import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { currentScope, runWithProfile } from "../../src/core/context.js";
import { profileOutside, serveOutside, type OutsideRecorder } from "../../src/core/outside.js";
import {
  beginOperation,
  beginQuery,
  endProfile,
  finishOperation,
  finishQuery,
  startProfile,
} from "../../src/core/recorder.js";
import { clearProfiles, listProfiles } from "../../src/core/storage.js";

const framework = { name: "test" };
let outside: OutsideRecorder | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  clearProfiles();
});
afterEach(() => {
  outside?.stop();
  vi.useRealTimers();
});

/** One operation and its query, as Prisma would record them wherever the code runs now. */
function query(model = "User", line = 12) {
  const scope = currentScope()!;
  const origin = [{ file: `${process.cwd()}/jobs/emails.ts`, line }];
  const op = beginOperation(scope.profile, { model, action: "findMany", origin });
  const record = beginQuery(scope.profile, { sql: `SELECT * FROM "${model}"`, opIds: [op.id] })!;
  return {
    profile: scope.profile,
    finish: () => {
      finishQuery(scope.profile, record);
      finishOperation(scope.profile, op);
    },
  };
}

it("records nothing outside requests unless the app's dev command set it up", () => {
  expect(currentScope()).toBeUndefined();
});

it("records a script's whole run as one profile, named after its file", () => {
  outside = profileOutside({ script: "prisma/seed.ts", framework });
  query("User").finish();
  vi.advanceTimersByTime(5_000);
  query("Post").finish();
  expect(listProfiles()).toEqual([]);
  const profile = outside.close()!;
  expect(profile).toMatchObject({ kind: "script", request: { method: "", url: "prisma/seed.ts" } });
  expect(profile.operations.map((op) => op.model)).toEqual(["User", "Post"]);
  expect(listProfiles()).toEqual([profile]);
});

it("keeps nothing for a script that made no query", () => {
  outside = profileOutside({ script: "scripts/hello.ts", framework });
  currentScope();
  expect(outside.close()).toBeUndefined();
  expect(listProfiles()).toEqual([]);
});

it("calls what ran before the process served its startup, and records bursts after", () => {
  outside = profileOutside({ script: "src/server.ts", framework });
  query("Setting").finish();
  outside.serve();
  expect(listProfiles()[0]).toMatchObject({ kind: "startup", request: { url: "src/server.ts" } });
  query("Email", 7).finish();
  query("Email", 9).finish();
  vi.advanceTimersByTime(200);
  expect(listProfiles()[0]).toMatchObject({
    kind: "background",
    request: { url: "jobs/emails.ts:7" },
    summary: { queryCount: 2 },
  });
});

it("takes a task as the sign the process serves, as listening is", () => {
  outside = profileOutside({ script: "src/worker.ts", framework });
  query("Queue").finish();
  serveOutside();
  expect(listProfiles().map((profile) => profile.kind)).toEqual(["startup"]);
  expect(outside.script).toBeUndefined();
});

it("keeps a burst open while one of its queries still runs, and starts another after it ends", () => {
  outside = profileOutside({ framework });
  const slow = query();
  vi.advanceTimersByTime(1_000);
  expect(listProfiles()).toEqual([]);
  slow.finish();
  vi.advanceTimersByTime(200);
  expect(listProfiles()).toHaveLength(1);
  const next = query();
  expect(next.profile).not.toBe(slow.profile);
  next.finish();
  vi.advanceTimersByTime(200);
  expect(listProfiles()).toHaveLength(2);
});

it("leaves a request's queries in the request, and sends what runs after it ended to a burst", () => {
  outside = profileOutside({ framework });
  const request = startProfile({ method: "GET", url: "/orders", kind: "document" }, framework);
  runWithProfile(request, () => {
    expect(query().profile).toBe(request);
    endProfile(request, { status: 200 });
    expect(query().profile.profile.kind).toBe("background");
  });
});
