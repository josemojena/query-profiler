import type { ActiveProfile } from "./recorder.js";
import type { StackFrame } from "./profile.js";
import { state } from "./state.js";

export interface Scope {
  profile: ActiveProfile;
  opId?: string;
  origin?: StackFrame[];
  /** Where the app made the database call running now, taken when it was made. */
  call?: StackFrame[];
  /** Set while a statement is being recorded, so a lower layer does not record it again. */
  recording?: boolean;
}

export function runWithProfile<T>(profile: ActiveProfile, fn: () => T): T {
  return state().als.run({ profile }, fn);
}

/** Makes `profile` the current one for the rest of the current async execution, not just a callback. */
export function enterProfile(profile: ActiveProfile): void {
  state().als.enterWith({ profile });
}

export function runInScope<T>(patch: Omit<Scope, "profile">, fn: () => T): T {
  const scope = currentScope();
  return scope ? state().als.run({ ...scope, ...patch }, fn) : fn();
}

/** Changes the scope for the rest of the current async execution, not just a callback. */
export function enterScope(patch: Omit<Scope, "profile">): void {
  const scope = currentScope();
  if (scope) state().als.enterWith({ ...scope, ...patch });
}

export function currentScope(): Scope | undefined {
  const scope = state().als.getStore();
  return scope && !scope.profile.closed ? scope : undefined;
}
