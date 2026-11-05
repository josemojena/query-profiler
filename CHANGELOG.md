# Changelog

## Unreleased

- A page's calls hang from it as a tree, in the bar's Requests tab and in the `/_profiler` list:
  only the page keeps its box, and each call shows its method and status as text, joined to the
  page by a thin line.
- In React Router 8, a client navigation home now becomes the new page in the bar: React Router 8
  loads `/` from `/_.data`, which the bar and the profiles took for a path of its own (`/_`).
- An app run with tsx gets the right line of code for each query again; the line was mapped twice
  through the same source map.
- **Express 4.18 and later**, 5 included: `app.use(profilerMiddleware())` from
  `query-profiler/express` profiles each request, tags each response with `X-Debug-Token` (exposed
  to CORS), names the route that answered and serves `/_profiler`.
- The profiler's API answers `HEAD` like `GET`, with no body.
- **Development only, without a bundler**: the docs show how to keep `query-profiler` a dev
  dependency for a server run with plain `node` (import it only if it is installed), or bundled
  with tsup, esbuild, Rollup or webpack; the Express and Fastify examples are set up that way, and
  CI checks that the examples run with the package not installed.
- A server bundled with the profiler in development starts and serves `/_profiler`: the core finds
  its UI files from the app too, as a bundler moves it out of its package.
- The line of code behind each query is found through the bundle's source maps when Node runs with
  `--enable-source-maps`, even if a framework formats stack traces itself.

## 0.2.1

- The package now links to its website, https://query-profiler.dev, with the docs and a live demo
  of the bar and the profiler page.

## 0.2.0

- **Fastify 4.26 and later.** `app.register(profilerPlugin)` from `query-profiler/fastify` profiles
  each request, tags each response with `X-Debug-Token` (exposed to CORS) and serves `/_profiler`.
  Without a bundler, install the package as a dependency and run the dev server with
  `--conditions=development`; plain `node` loads the entry that does nothing.
- `createHandler()` serves the bar and the profiler page's code itself (`/_profiler/ui.js`), so
  `/_profiler` works on servers without Vite.
- The profiler also runs when `NODE_ENV` is not set, as servers without a bundler leave it, so
  `--conditions=development` alone turns it on there. `NODE_ENV=production` or `test` still keep it
  off.
- `withProfiler()`, `profilePrisma()`, `profilePool()` and `profileAdapter()` return what they are
  given, untouched, outside development, like the middleware and the plugin: even if the real code
  were loaded in production, Prisma's SQL would carry no stamp and nothing would be wrapped.
- The terminal line from `formatProfile()` says `1 query`, `1 operation` and `1 warning` in the
  singular.

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
