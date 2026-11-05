/**
 * Whether this Node honours the conditions a synchronous module hook adds: 22.19+ and 24.5+.
 * Before them, import ignores those conditions and require() throws on them.
 */
export function addsConditions(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 19);
}
