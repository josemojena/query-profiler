import { DEFAULT_BASE } from "../core/constants.js";
import { createElement, useEffect } from "react";

export interface ProfilerToolbarProps {
  base?: string;
  /** Where "open in editor" goes. */
  editor?: "vscode" | "cursor" | "none";
}

/** The bar at the bottom of every page. Render it only in development. */
export function ProfilerToolbar({ base = DEFAULT_BASE, editor = "vscode" }: ProfilerToolbarProps) {
  useEffect(() => {
    void import("../ui/index.js");
  }, []);
  return createElement("query-profiler-toolbar", { "data-base": base, "data-editor": editor });
}
