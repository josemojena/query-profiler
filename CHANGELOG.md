# Changelog

## Unreleased

- Fastify 4.26 and later: `app.register(profilerPlugin)` from `query-profiler/fastify` profiles
  each request, tags each response with `X-Debug-Token` (exposed to CORS) and serves `/_profiler`.
- `createHandler()` serves the bar and the profiler page's code itself (`/_profiler/ui.js`), so
  `/_profiler` works on servers without Vite.

## 0.1.2

- The bar and the profiler page showed nothing when `profilerMiddleware()` was called without
  `onProfile`, as the README sets it up: the profile was never stored. Now every profile is stored,
  with or without `onProfile`.
- A tab in the background no longer holds a connection to the dev server: the bar and the profiler
  page stop listening for new requests while their tab is hidden, and catch up when it shows again.
  Over HTTP/1.1 browsers allow six connections per host, so many open tabs used to stall the app.

## 0.1.1

- Secrets no longer show in SQL parameters. A parameter is hidden when it equals a value the
  Prisma operation passed under a secret-looking key (`password`, `token`, `apiKey`…), or when the
  SQL compares it with or writes it to a column named like one, raw SQL included.

## 0.1.0

First release.

- Captures every PostgreSQL statement sent through Prisma 7.1+ or `pg`, linked to the Prisma
  operation and the line of code behind it, per request.
- N+1, slow and duplicate warnings; time the database was busy.
- React Router 7.9+ and 8: one profile per request, and the calls a page makes (fetchers,
  navigations, actions) hung under it.
- A bar at the bottom of every page and a full profiler page at `/_profiler`, with stats.
- A Vite plugin that serves both in development and leaves the profiler out of builds.
