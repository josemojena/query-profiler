import type { ProfileListItem } from "../core/index.js";

interface Follower {
  onProfile: (item: ProfileListItem) => void;
  /** The stream reopened after a gap: ask for what finished meanwhile. */
  onResume: () => void;
}

/**
 * Hears of each profile the server finishes, but only while the tab is visible: a hidden tab
 * gives its connection back, as browsers allow six per host over HTTP/1.1. Returns how to stop.
 */
export function followProfiles(url: string, { onProfile, onResume }: Follower): () => void {
  let events: EventSource | undefined;
  let behind = false;
  const update = () => {
    if (document.hidden) {
      events?.close();
      events = undefined;
      behind = true;
    } else if (!events) {
      events = new EventSource(url);
      events.addEventListener("profile", (event) =>
        onProfile(JSON.parse(event.data) as ProfileListItem),
      );
      // The server listens before it answers, so from here on nothing is missed.
      events.addEventListener("open", () => {
        if (behind) onResume();
        behind = false;
      });
      events.addEventListener("error", () => (behind = true));
    }
  };
  document.addEventListener("visibilitychange", update);
  update();
  return () => {
    document.removeEventListener("visibilitychange", update);
    events?.close();
  };
}

/** Both lists as one, newest finished first, each profile once. */
export function mergeProfiles(
  newer: ProfileListItem[],
  older: ProfileListItem[],
  limit = Infinity,
): ProfileListItem[] {
  const byToken = new Map<string, ProfileListItem>();
  for (const item of [...newer, ...older])
    if (!byToken.has(item.token)) byToken.set(item.token, item);
  return [...byToken.values()].sort((a, b) => finishedAt(b) - finishedAt(a)).slice(0, limit);
}

const finishedAt = (item: ProfileListItem) => item.startedAt + (item.durationMs ?? 0);
