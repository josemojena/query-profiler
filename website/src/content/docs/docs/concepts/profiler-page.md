---
title: The profiler page
description: The full view at /_profiler, a profile at /_profiler/:token, and stats.
---

`/_profiler` is the full view, the same data with room to read it:

- **Requests**: every recent request on the left, each page with its calls under it, filterable by
  path or status. On the right, the one you pick (`/_profiler/:token`): method, path, status and time;
  cards for queries, time in the database, operations and warnings; the calls it made; the same tabs
  as the bar; and its JSON to download.
- **Stats** (`/_profiler/stats`): across the stored requests, the slowest and the most repeated
  statement shapes, time by model and by route.

**Clear**, next to Requests and Stats, removes every stored request. Every open tab with the
profiler or the bar empties its lists too; the bar keeps the page it is on.

It shares the bar's theme: dark by default, with the switch next to its name for **Light** or
**Auto**.

[Open the demo](/demo-profiler) to try it on sample data.
