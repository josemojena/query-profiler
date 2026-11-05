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
