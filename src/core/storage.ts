import type { Profile } from "./profile.js";
import { state } from "./state.js";

// A job that runs every second would otherwise push every request out.
const BACKGROUND_LIMIT = 20;

/** Keeps a profile, newest first; one with a token already kept takes its place. */
export function storeProfile(profile: Profile): void {
  const { profiles, listeners, limit } = state();
  const index = profiles.findIndex((stored) => stored.token === profile.token);
  if (index >= 0) profiles[index] = profile;
  else profiles.unshift(profile);
  const background = profiles.filter((stored) => stored.kind === "background");
  for (const oldest of background.slice(BACKGROUND_LIMIT))
    profiles.splice(profiles.indexOf(oldest), 1);
  profiles.length = Math.min(profiles.length, limit);
  for (const listener of listeners) listener(profile);
}

/** Newest first. */
export function listProfiles(): Profile[] {
  return [...state().profiles];
}

export function getProfile(token: string): Profile | undefined {
  return state().profiles.find((profile) => profile.token === token);
}

export function onProfile(listener: (profile: Profile) => void): () => void {
  const { listeners } = state();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Empties the storage, and tells whoever listens with `onClear()`. */
export function clearProfiles(): void {
  const current = state();
  current.profiles.length = 0;
  for (const listener of current.clearListeners ?? []) listener();
}

export function onClear(listener: () => void): () => void {
  const listeners = (state().clearListeners ??= new Set());
  listeners.add(listener);
  return () => listeners.delete(listener);
}
