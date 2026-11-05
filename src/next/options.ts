const PROFILER_OPTIONS = [
  "--conditions=development",
  "--enable-source-maps",
  "--import query-profiler/next/register",
];

/** The arguments for Next's CLI, and the NODE_OPTIONS that load the profiler into `next dev` only. */
export function nextCommand(
  args: string[],
  nodeOptions = "",
): { args: string[]; nodeOptions: string } {
  if (args[0] !== "dev") return { args, nodeOptions };
  return { args, nodeOptions: [nodeOptions.trim(), ...PROFILER_OPTIONS].filter(Boolean).join(" ") };
}
