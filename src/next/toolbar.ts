import { createElement } from "react";
import { currentScope, DEFAULT_BASE } from "../core/index.js";
import { toolbarScript } from "../ui/snippet.js";

export interface ProfilerToolbarProps {
  /** Where the profiler's page and API live. */
  base?: string;
}

/** The bar at the bottom of every page. A Server Component: render it once, in the root layout. */
export function ProfilerToolbar({ base = DEFAULT_BASE }: ProfilerToolbarProps) {
  const token = currentScope()?.profile.profile.token;
  if (!token) return null;
  return createElement("script", {
    dangerouslySetInnerHTML: { __html: toolbarScript(base, token) },
  });
}
