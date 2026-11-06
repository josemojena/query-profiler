---
title: The profiler page
description: The full view at /_profiler, a profile at /_profiler/:token, and stats.
---

`/_profiler` is the full view, the same data with room to read it:

- **Requests**: every recent request on the left, each page with its calls under it, filterable by
  path or status. [Scripts, tasks, startups and background work](/docs/guides/scripts) are listed
  with them, by what ran instead of a method and status. On the right, the one you pick
  (`/_profiler/:token`): method, path, status and time; cards for queries, time in the database,
  operations and warnings; the calls it made; the same tabs as the bar, with **Run** in place of
  **Request** for a script or a task; and its JSON to download. The page opens on the newest one
  that is not background work.
- **Stats** (`/_profiler/stats`): across the stored requests, the slowest and the most repeated
  statement shapes, time by model and by route. On top, **Analyze the session ›** adds up the
  [query analysis](/docs/concepts/query-analysis#the-whole-session) of
  every distinct statement: the indexes to add, ranked by the time they would fix, what the rules
  find across the session, and the tables the time goes to.

**Clear**, next to Requests and Stats, removes every stored request. Every open tab with the
profiler or the bar empties its lists too; the bar keeps the page it is on.

It shares the bar's theme: dark by default, with the switch next to its name for **Light** or
**Auto**.

[Open the demo](/demo-profiler) to try it on sample data.
