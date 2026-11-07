# Changelog

## Unreleased

### Fixed

- **The index to add uses your schema's names.** For a model mapped with `@@map` or a field mapped
  with `@map` (`authorId Int @map("author_id")`), the `@@index` line said the database's names
  (`@@index([author_id])`), which Prisma does not accept. It now says `@@index([authorId])`, and
  names the model, from the `schema.prisma` the profiler already reads; so do the trigram and
  `@@fulltext` lines. The SQL keeps the database's names.

## 0.4.0

Query analysis: each query's plan, the index that fixes it and whether the database would use it,
on every engine, and across the session the indexes that fix the most time. Also profiles for the
work no request starts (scripts, startup, background work, tasks), the rows of each query, the code
that fixes an N+1, and an MCP server for AI agents.

### New

- **An MCP server for AI agents**, in the profiler itself: `http://localhost:4983/_profiler/mcp`,
  for any app (the preload and the Vite plugin open that port). An agent reads the same profiles
  as the page, through seven tools: `list_requests`, `get_request`, `fix_n1`, `explain_query`
  (`measure: true` runs a read in a transaction that is rolled back), `try_index`,
  `analyze_session` and `get_stats`. Every tool but `try_index` only reads. It runs with the
  official SDK, `@modelcontextprotocol/server`, loaded once an agent connects; like the rest of
  the API it answers only local hosts, and turns away a page of another site. The terminal says
  where it is. Claude Code: `claude mcp add --transport http query-profiler
  http://localhost:4983/_profiler/mcp`.
- **Two dependencies**: `@modelcontextprotocol/server` and `zod`, which it uses. The package had
  none; both install only where query-profiler does, as a dev dependency.
- **The rows of each query.** Each query keeps the rows it returned, or the rows a write changed
  (`rows`, `changedRows`), from Prisma's driver adapter and from `pg`, on every engine. Queries and
  Operations have a **Rows** column; an N+1 row shows the rows of each run.
- **Fix the N+1 ›**, on an N+1 row and on the N+1 warning. It says what repeats, which value changes
  each time and which earlier query those values came from, then the code that replaces the loop,
  best first, each with the queries it saves and **Copy**: `_count` or `include` in the query
  before, `groupBy`, `findMany` with `in`, `createMany`, `createManyAndReturn` with `createMany` for
  nested creates, `updateMany`, `deleteMany`. When no single query replaces the loop, it says so.
  The relation names come from the app's `schema.prisma`, which the profiler finds by itself.
- **A hint for many rows**: a read with no limit that returned 1,000 rows or more (rule
  `many-rows`).
- **A script's terminal summary** ends an N+1's line with its fix: `→ createMany: 2 queries
  instead of 30`.
- **New route**: `GET /api/profiles/:token/fixes`.
- **Query analysis.** Every query the database can be asked about has **Explain ›** in the Queries
  tab, of the bar and of `/_profiler`. It opens the query's tools, in a row of their own under it:
  - **Explain plan**: the database's estimated plan, read into the same steps for every engine
    (a table read in full, an index used, a sort, a temporary table), the tables' indexes, and what
    the rules find, most severe first, each with its fix: the `@@index` line for `schema.prisma`,
    the SQL, or the change to the query.
  - **Measure it**: a read run in a transaction that is rolled back, with the rows and time each
    step really had. Never a write, a locking read, or SQLite, which does not measure plans.
  - **Try this index**, on PostgreSQL and SQLite: the suggested index created in a transaction that
    is rolled back, and the plan asked again, to show whether the database uses it and the cost
    without it and with it.
- **Rules from each engine's manual**, each linking to the section that backs it and tested against
  the real engine: PostgreSQL 13 to 18, MySQL 8.0 to 9.x (and its JSON format version 2, the default
  from 9.5), MariaDB 10.6 to 11.x, and SQLite. See every rule at
  https://query-profiler.dev/docs/reference/rules.
- **Analysis of the session**, on top of Stats in `/_profiler`. **Analyze the session ›** plans
  every distinct statement of the stored requests once, through its slowest run, and adds them up:
  the indexes to add, ranked by the time they would fix (an index that starts another's columns is
  folded into the wider one), what the rules find across the session, and the tables the time goes
  to. **Open** goes to a finding's slowest statement, in its request, on Explain plan.
- **Hints under a closed row** from the SQL and its values alone, with no database: a `%` first,
  `ILIKE`, a function on a filtered column, a deep `OFFSET`, a `NOT IN` with a `NULL`… They do not
  count as warnings.
- **Four new routes**: `GET /api/profiles/:token/findings`, `GET
  /api/profiles/:token/queries/:id/analysis`, `POST /api/profiles/:token/queries/:id/trial` and
  `GET /api/stats/analysis`. The three that ask the database need the `X-Query-Profiler` header.
- **The database work no request started.** Until now a query outside a request was dropped. With
  the preload, it has a profile too:
  - **A script** (`tsx --import query-profiler/register prisma/seed.ts`), a process that never
    listens, is one profile: its whole run. When it ends, the terminal sums it up, each warning with
    its line of code, and links to it in the profiler your app's dev server serves. A long one shows
    there while it still runs; one that ends with `process.exit()` gets there too.
  - **A server's startup**, what it does before it listens.
  - **Background work**: the queries between requests (a timer, a queue in the same process, work
    left running after a response), in bursts that close once nothing has run for 200 ms, named
    after the line that started them. The last 20 are kept.
- **`profileTask(name, fn)`**, from `query-profiler/prisma`: a job of a worker, or a run of a cron,
  in a profile of its own, as a request has. Outside development it only runs `fn`.
- **The Vite plugin opens the profiler's own port** (4983) as well, so scripts run with the preload
  reach React Router's profiler. `/_profiler` stays on the app's port.
- **The lists say what each profile is.** A request keeps its method and status, now in a pill in
  every list, as in the bar's table. A script, a startup, a task or background work shows its kind in
  a grey pill, next to its name, and its **Run** tab replaces **Request**. `/_profiler` opens on the
  newest profile that is not background work, which the bar also leaves out of **Recent** (until now
  **Recent requests**).
- **Past 1,000 queries, a profile counts the rest** (`summary.unrecordedQueries`), and its warning
  says how many there were.
- **The React Router example** has a `/problems` page with a query for each common problem, on a
  database of 60,000 posts. **The Express example's seed** runs through the profiled client:
  `pnpm --filter example-express db:seed`.

### Fixed

- With several processes sharing one profiler (a cluster, two apps), each process's profiles
  arrive in the order they finished: one could get there before an older one and be listed as
  older.

### Changed

- `POST /api/profiles` takes a profile again with a token it already has, as a script's grows: the
  one with the longer duration stays.
- `ProfileKind` has `script`, `startup` and `task`; `background` is now used. Their `request.method`
  is empty and `request.url` names what ran.

## 0.3.0

One way for each kind of app, with no profiler code in your server: the Vite plugin for React
Router, a preload for any other Node server. Also MySQL, MariaDB and SQLite, one profiler for
several processes, SQL laid out over lines, themes, and Clear.

### Breaking changes, and how to upgrade from 0.2

- **Node 22.19+ or 24.5+.** The preload gives your app's imports of the profiler its real code
  through Node's synchronous module hooks, which cover `require()` too. Before 22.19 and 24.5, Node
  ignores what such a hook adds on `import` and throws on it in `require()`, so there the preload
  says so and stays off. Node 20, out of support since April 2026, is no longer supported.
- **React Router: the Vite plugin alone.** `queryProfiler()` in `vite.config.ts` now profiles each
  request, puts the bar on every page and serves `/_profiler`. Remove `profilerMiddleware()` from
  your root route (and the `.server` module that created it), and `<ProfilerToolbar />` if you used
  it; React Router 7 no longer needs `future.v8_middleware` for the profiler.
  `query-profiler/react-router`, `/react-router/route` and `/react-router/toolbar` are gone.
- **Fastify, and any Node server: the preload.** Remove `app.register(profilerPlugin)` and its import
  from `query-profiler/fastify`, and add `--import query-profiler/register` to your dev command. The
  profiler moves to a port of its own: `http://localhost:4983/_profiler`. `query-profiler/fastify`
  is gone, and the package no longer depends on `fastify-plugin`.
- **No `--conditions=development` in a dev command any more**: the preload adds it. Leaving it does
  no harm.

### New

- **Any Node server, with no code in it: Express, Fastify, Koa, Hapi, NestJS, Hono.** Add
  `--import query-profiler/register` to the dev command (`node --watch`, `tsx watch`, nodemon, the
  Nest CLI, or `NODE_OPTIONS`). The preload profiles each request from Node's
  `http.server.request.start` diagnostics channel, tags each response with `X-Debug-Token` (exposed
  to CORS), and serves the profiler on a port of its own: 4983, or `QUERY_PROFILER_PORT`. It opens
  that port once the app listens, waits a moment for a restarting app to let go of it, then takes the
  next free one. `QUERY_PROFILER_LOG=1` prints one line per request.
- **One profiler for several processes**: Node's `cluster`, PM2 in cluster mode, or two apps at once.
  The first process serves it and the others send it their profiles (`POST /_profiler/api/profiles`,
  JSON only and never from a browser page); when it stops, another one takes the port over.
- **`QUERY_PROFILER_HOST`** picks where the profiler listens: `0.0.0.0` reaches it from outside a
  container with its port published. It still answers only requests addressed to a local host, so the
  network cannot read it.
- **MySQL, MariaDB and SQLite**, through Prisma's own adapters (`@prisma/adapter-mariadb` and
  `@prisma/adapter-better-sqlite3`), tested in CI on MySQL 8.4, MariaDB 11.4 and SQLite with the same
  checks as PostgreSQL. Secrets are hidden in their `?` parameters and backtick-quoted columns too,
  and "Copy runnable SQL" fills the `?` in order. Raw SQL is recorded through Prisma's `$queryRaw`;
  through your own MySQL or SQLite driver it is not.
- **SQL laid out over lines.** Opening a query shows its SQL as it would be written by hand: one
  clause per line, a long list one item per line, a long condition one `AND` per line, subqueries
  indented, with keywords, strings and parameters in colour. "Copy runnable SQL" copies it that way.
  Only whitespace moves, never inside strings or quoted names; SQL with a line comment or a
  dollar-quoted body stays as written.
- **Themes.** The bar and the profiler page are dark by default, in the website's colours, with a
  light theme and **Auto**, which follows the system. A switch in both picks it, and the browser
  keeps the choice. A page can set the starting theme with `data-theme` on the element.
- **Clear**, in the profiler page and in the bar's recent requests, removes every stored request. The
  stream announces it (`event: clear`), so every open tab empties its lists; the bar keeps the page it
  is on.
- **A page's calls hang from it** on one line, a branch and a dot each, in the bar and in the
  profiler page's list, instead of a box each.
- **HTTP/2 servers** (Fastify with `http2: true`, Hono on an HTTP/2 server) are profiled too, on Node
  22.17+ and 24.2+. Their responses carry no `X-Debug-Token`.
- **The preload says why it is off** instead of staying silent: a `NODE_ENV` other than
  `development`, or a Node older than 22.19 or 24.5. Production, test runs and
  `QUERY_PROFILER_DISABLED=1` stay silent.
- **Development only, without a bundler**: the docs show how to keep `query-profiler` a dev
  dependency for a server run with plain `node`, or bundled with tsup, esbuild, Rollup or webpack.
  CI checks that the examples run with the package not installed.
- A **troubleshooting page** in the docs, for when requests or queries do not show up.
- The profiler's API answers `HEAD` like `GET`, with no body.

### Fixed

- Compiled code run without `--enable-source-maps` (`tsc` and `node --watch dist/server.js`) shows
  each query's line in its source: the profiler reads the app file's source map itself.
- The line of code behind each query is found through a bundle's source maps when Node runs with
  `--enable-source-maps`, even if a framework formats stack traces itself.
- An app run with tsx gets the right line of code for each query again; the line was mapped twice
  through the same source map.
- A server bundled with the profiler in development serves `/_profiler`: the core finds its UI files
  from the app too, as a bundler moves it out of its package.
- In React Router 8, a client navigation home becomes the new page in the bar: React Router 8 loads
  `/` from `/_.data`, which the bar and the profiles took for a path of its own (`/_`).
- A tab that was hidden while the profiler was cleared, or while the dev server restarted, takes the
  server's lists when it comes back instead of merging them with its own, so gone requests do not
  come back.

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
