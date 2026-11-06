// Same as the core's ANALYSIS_HEADER: the UI's files are served on their own and import none of it.
const ANALYSIS_HEADER = "X-Query-Profiler";

/** Empties the profiler's storage; whether the server did. */
export async function clearAll(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/api/profiles`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

export async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** A call to the routes that ask the database, which need the profiler's header. */
export async function askProfiler<T>(
  url: string,
  init: RequestInit = {},
): Promise<{ body: T } | { error: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [ANALYSIS_HEADER]: "1",
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      error?: string;
    };
    if (response.ok) return { body };
    return {
      error: body.message ?? `the profiler answered ${response.status} (${body.error ?? "error"})`,
    };
  } catch {
    return { error: "the profiler could not be reached." };
  }
}
