import { beforeEach, expect, it } from "vitest";
import type { Profile, ProfileKind } from "../../src/core/profile.js";
import { clearProfiles, listProfiles, storeProfile } from "../../src/core/storage.js";

let next = 0;
const profile = (kind: ProfileKind): Profile =>
  ({ token: (next++).toString(16).padStart(6, "0"), kind }) as Profile;

beforeEach(() => clearProfiles());

it("keeps a profile sent again in its place, as the newer copy", () => {
  const first = profile("script");
  storeProfile(first);
  storeProfile(profile("document"));
  const grown = { ...first, durationMs: 900 };
  storeProfile(grown);
  expect(listProfiles()).toHaveLength(2);
  expect(listProfiles()[1]).toBe(grown);
});

it("keeps only the newest 20 background profiles, so a job that runs every second leaves the requests", () => {
  const page = profile("document");
  storeProfile(page);
  const bursts = Array.from({ length: 30 }, () => profile("background"));
  for (const burst of bursts) storeProfile(burst);
  const kept = listProfiles();
  expect(kept).toContain(page);
  expect(kept.filter((stored) => stored.kind === "background")).toEqual(bursts.slice(10).reverse());
});
