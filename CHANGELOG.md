# Changelog

## Unreleased

- **Breaking: Node 22.19+ or 24.5+.** The preload gives the app's own imports of the profiler its real
  code through Node's synchronous module hooks, so `--import query-profiler/register` is the only flag
  a dev command needs; they cover `require()` too. Before 22.19 and 24.5, Node ignores the conditions
  such a hook adds on `import` and throws on them in `require()`: there the preload says so and stays
  off. Node 20, out of support since April 2026, is no longer supported.
- **React Router: the Vite plugin alone.** `queryProfiler()` in `vite.config.ts` now profiles every
  request in the dev server, puts the bar on every page and serves `/_profiler`; nothing goes in
  your routes, and React Router 7 no longer needs `future.v8_middleware`. The bar learns its page's
  token from the page's `Server-Timing` header. `log: true` prints one line per request.
  **Breaking:** `query-profiler/react-router`, `/react-router/route` and `/react-router/toolbar`
  are gone, with `profilerMiddleware()` and `<ProfilerToolbar />`: remove them from your app.
- In React Router 8, a client navigation home now becomes the new page in the bar: React Router 8
  loads `/` from `/_.data`, which the bar and the profiles took for a path of its own (`/_`).
- An app run with tsx gets the right line of code for each query again; the line was mapped twice
  through the same source map.
- **Any Node server, with no code in it: Express, Fastify, Koa, Hapi, NestJS, Hono.** Add
  `--import query-profiler/register` to the dev command (`node --watch`,
  `tsx watch`, nodemon, the Nest CLI, or `NODE_OPTIONS`). The preload profiles each request from
  Node's `http.server.request.start` diagnostics channel, tags each response with `X-Debug-Token`
  (exposed to CORS), and serves the profiler on a port of its own: 4983, or `QUERY_PROFILER_PORT`.
  It opens that port once the app listens, waits a moment for a restarting app to let go of it,
  then takes the next free one. `QUERY_PROFILER_LOG=1` prints one line per request.
  **Breaking:** `query-profiler/fastify` and its `profilerPlugin` are gone: remove them from your
  server, and add the preload to its dev command. The package no longer depends on `fastify-plugin`.
- The profiler's API answers `HEAD` like `GET`, with no body.
- **Development only, without a bundler**: the docs show how to keep `query-profiler` a dev
  dependency for a server run with plain `node` (the Prisma client imports it only if it is
  installed), or bundled with tsup, esbuild, Rollup or webpack; the Express and Fastify examples
  are set up that way, and CI checks that the examples run with the package not installed.
- A server bundled with the profiler in development serves `/_profiler`: the core finds its UI files
  from the app too, as a bundler moves it out of its package.
- The line of code behind each query is found through the bundle's source maps when Node runs with
  `--enable-source-maps`, even if a framework formats stack traces itself.
- The preload says why it is off instead of staying silent: a `NODE_ENV` other than `development`.
  Production, test runs and `QUERY_PROFILER_DISABLED=1` stay silent.
- HTTP/2 servers (Fastify with `http2: true`, Hono on an HTTP/2 server) are profiled too, on Node
  22.17+ and 24.2+. Their responses carry no `X-Debug-Token`.
- Compiled code run without `--enable-source-maps` (`tsc` and `node --watch dist/server.js`) shows
  each query's line in its source again: the profiler reads the app file's source map itself.
- A troubleshooting page in the docs, for when requests or queries do not show up.
- **MySQL, MariaDB and SQLite**, through Prisma's own adapters (`@prisma/adapter-mariadb` and
  `@prisma/adapter-better-sqlite3`), tested in CI on MySQL 8.4, MariaDB 11.4 and SQLite with the
  same checks as PostgreSQL. Secrets are hidden in their `?` parameters and backtick-quoted columns
  too, and "Copy runnable SQL" fills the `?` in order. Raw SQL is recorded through Prisma's
  `$queryRaw`; through your own MySQL or SQLite driver it is not.
- **SQL laid out over lines.** Opening a query shows its SQL as it would be written by hand: one
  clause per line, a long list one item per line, a long condition one `AND` per line, subqueries
  indented, with keywords, strings and parameters in colour. "Copy runnable SQL" copies it that way.
  Only whitespace moves, never inside strings or quoted names; SQL with a line comment or a
  dollar-quoted body stays as written.
- **One profiler for several processes**: Node's `cluster`, PM2 in cluster mode, or two apps at
  once. The first process serves it and the others send it their profiles
  (`POST /_profiler/api/profiles`, JSON only and never from a browser page); when it stops, another
  one takes the port over. Before, a cluster's primary opened an empty profiler and its workers
  shared another one, half of the requests at a time.
- `QUERY_PROFILER_HOST` picks where the profiler listens: `0.0.0.0` reaches it from outside a
  container with its port published. It still answers only requests addressed to a local host, so
  the network cannot read it.
- **Clear**, in the profiler page and in the bar's recent requests, removes every stored request.
  The stream announces it (`event: clear`), so every open tab empties its lists; the bar keeps the
  page it is on. A tab that was hidden meanwhile takes the server's lists when it comes back, instead
  of merging them with its own, so cleared requests do not come back.
- **Themes.** The bar and the profiler page are dark by default, in the website's colors, with a
  light theme and **Auto**, which follows the system. A switch in both picks it, and the browser
  keeps the choice. A page can set the starting theme with `data-theme` on the element.
- A page's calls hang from it on one line, a branch and a dot each, in the bar and in the profiler
  page's list, instead of a box each.

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
