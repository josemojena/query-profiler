import type { KindCounts, ProfileKind } from "../core/index.js";

export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const WORK: [ProfileKind, string][] = [
  ["script", "script"],
  ["task", "task"],
  ["startup", "startup"],
  ["background", "background run"],
];

/** What the stored profiles are, in words: "12 requests, 2 scripts and 1 task". */
export function countedKinds(kinds: KindCounts): string {
  const work = new Set(WORK.map(([kind]) => kind));
  const requests = Object.entries(kinds)
    .filter(([kind]) => !work.has(kind as ProfileKind))
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  const parts = [
    ...(requests ? [count(requests, "request")] : []),
    ...WORK.flatMap(([kind, word]) => (kinds[kind] ? [count(kinds[kind], word)] : [])),
  ];
  if (parts.length <= 1) return parts[0] ?? count(0, "request");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
