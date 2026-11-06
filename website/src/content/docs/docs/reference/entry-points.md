---
title: Entry points
description: What each import of query-profiler gives you.
---

One package, one entry per integration. Import only the ones you use: an entry you don't import is
never loaded.

| Import                    | What it does                                                                                                                | Needs                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `query-profiler`          | The `Profile` format, the per-request context, storage, analysis, `formatProfile()` and the HTTP handler `createHandler()`. | nothing                     |
| `query-profiler/prisma`   | `withProfiler()`, `profilePrisma()`, `profilePool()`: the Prisma ORM integration. `profileTask()`: a job's own profile.     | `@prisma/client` 7.1+, `pg` |
| `query-profiler/register` | A preload for Node (`--import`): a profile per request or per script run, and the profiler on a port of its own.            | Node 22.19+ or 24.5+        |
| `query-profiler/vite`     | `queryProfiler()`: for React Router, a profile per request, the bar and `/_profiler` in development; nothing in builds.     | `vite` 6+                   |
| `query-profiler/ui`       | The bar (`<query-profiler-toolbar>`) and the page (`<query-profiler-page>`) as web components.                              | a browser                   |

Every entry that runs in your app has a no-op version with the same API, which production gets:
builds through the Vite plugin, and plain `node` without the preload.

`query-profiler/register` is the only one you don't import: Node loads it before your app with
`--import`, in the dev command. Its environment variables:

| Variable              | Default     | What it does                                                                                        |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `QUERY_PROFILER_PORT` | `4983`      | The profiler's port; if it is busy, the next free one is taken.                                     |
| `QUERY_PROFILER_HOST` | `localhost` | Where it listens. `0.0.0.0` reaches it from outside a container; it still answers only local hosts. |
| `QUERY_PROFILER_LOG`  | unset       | `1` prints one line per request in the terminal.                                                    |
