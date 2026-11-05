---
title: Entry points
description: What each import of query-profiler gives you.
---

One package, one entry per integration. Import only the ones you use: an entry you don't import is
never loaded.

| Import                                | What it does                                                                                                                | Needs                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `query-profiler`                      | The `Profile` format, the per-request context, storage, analysis, `formatProfile()` and the HTTP handler `createHandler()`. | nothing                     |
| `query-profiler/prisma`               | `withProfiler()`, `profilePrisma()`, `profilePool()`: the Prisma ORM integration.                                           | `@prisma/client` 7.1+, `pg` |
| `query-profiler/react-router`         | `profilerMiddleware()`: a profile per request in React Router 7.9+ and 8.                                                   | `react-router` 7.9+         |
| `query-profiler/react-router/route`   | A resource route serving the profiler, for servers without Vite.                                                            | `react-router` 7.9+         |
| `query-profiler/react-router/toolbar` | `<ProfilerToolbar />`, for servers without Vite.                                                                            | `react`                     |
| `query-profiler/express`              | `profilerMiddleware()`: a profile per request in Express, and the profiler's page and API under `/_profiler`.               | `express` 4.18+             |
| `query-profiler/fastify`              | `profilerPlugin`: a profile per request in Fastify, and the profiler's page and API under `/_profiler`.                     | `fastify` 4.26+             |
| `query-profiler/vite`                 | `queryProfiler()`: serves the API and the UI in development, keeps the profiler out of builds.                              | `vite` 6+                   |
| `query-profiler/ui`                   | The bar (`<query-profiler-toolbar>`) and the page (`<query-profiler-page>`) as web components.                              | a browser                   |

Every entry that runs in your app has a no-op version with the same API, which production gets:
builds through the Vite plugin, and plain `node` without `--conditions=development`.
