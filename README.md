# query-profiler

[![npm](https://img.shields.io/npm/v/query-profiler)](https://www.npmjs.com/package/query-profiler)
[![CI](https://github.com/josemojena/query-profiler/actions/workflows/ci.yml/badge.svg)](https://github.com/josemojena/query-profiler/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Docs and live demo: [query-profiler.dev](https://query-profiler.dev)**

**The database profiler for Prisma ORM**, in development. Inspired by the Symfony profiler: for
every request your app serves, what Prisma did in the database and why.

- Every **Prisma operation** (`User.findMany`, `Order.create`…) with its arguments and the **line
  of your code** that called it.
- Every **SQL statement** Prisma sent for it, with its parameters and duration, including
  transactions, batches and the queries Prisma compacts.
- Warnings for **N+1** queries, **slow** queries and **duplicated** queries.
- Shown in a **bar at the bottom of your pages**, in a **full profiler page** and as JSON, dark by
  default or light.

It is built for Prisma ORM and needs it: it hooks into Prisma's driver adapter and client
extensions. Raw SQL you send with `pg` next to Prisma is captured too. It runs only in development
and leaves nothing in production builds.

## Requirements

| What       | Supported                                                            |
| ---------- | -------------------------------------------------------------------- |
| Prisma ORM | **7.1 or later**, with a driver adapter. Not 6; 8 is planned         |
| Database   | PostgreSQL, MySQL, MariaDB and SQLite, through Prisma's own adapters |
| Node       | 22.19+ or 24.5+                                                      |
| Raw SQL    | Prisma's `$queryRaw` on any of them; `pg` (node-postgres), optional  |
| Framework  | React Router 7.9+ and 8 in framework mode (also Remix), with Vite 6+ |
| Framework  | Any Node server: Express, Fastify, Koa, Hapi, NestJS, Hono           |

Prisma 6 is not supported: it has no SQL comments, and its query engine runs the driver adapter
outside the request's async context. Next.js is planned.

query-profiler is an independent project, not affiliated with Prisma or React Router.

## Entry points

One package, one entry per integration. Import only the ones you use: the frameworks and drivers
are optional peer dependencies, so installing `query-profiler` never pulls in Next.js, React or Vite, and
an entry you don't import is never loaded.

| Import                    | What it does                                                                                                                 | Needs                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `query-profiler`          | The `Profile` format, the per-request context, storage, analysis and the HTTP handler.                                       | nothing                     |
| `query-profiler/prisma`   | The Prisma ORM integration: every operation, its SQL and the line of code behind it.                                         | `@prisma/client` 7.1+, `pg` |
| `query-profiler/register` | A preload for Node servers (`--import`): a profile per request, and the profiler on a port of its own.                       | Node 20.19+                 |
| `query-profiler/vite`     | For React Router: a profile per request, the bar and `/_profiler` in the Vite dev server; nothing of the profiler in builds. | `vite` 6+                   |
| `query-profiler/ui`       | The bar and the profiler page, as web components with their styles inside. No framework.                                     | a browser                   |

## How it works

- **Request context.** Each request runs inside an `AsyncLocalStorage` scope that holds its
  profile, opened by the Vite plugin for React Router, or by the preload from Node's
  `http.server.request.start` diagnostics channel for any other Node server.
- **Statements.** `withProfiler()` wraps Prisma's driver adapter: Prisma hands every statement
  over, with its parameters and timing. `profilePool(pool)` adds raw SQL sent straight to `pg`;
  a statement is never recorded twice.
- **Operations.** `profilePrisma()` adds a client extension that records `User.findMany` and the
  like, with their arguments. It also takes the line of your code that made each call when the
  call is made: Prisma runs it later, when it is awaited, and Node before 26 loses the caller
  across that gap.
- **Linking statements to operations.** A sqlcommenter plugin, added by `withProfiler()`, stamps
  each statement with the operation it answers. The async context names the likely operation;
  the stamp settles it when Prisma batches or compacts queries. See [docs/spike.md](docs/spike.md).

## Installation

```sh
npm i -D query-profiler
```

Every entry that runs inside your app has a `development` build with the real code and a
`default` one that does nothing, with the same API. How it stays out of production depends on how
you ship the server:

| How you ship                                      | What leaves the profiler out                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A Vite build (React Router)                       | The Vite plugin puts the empty entries in the build: production never needs it        |
| A Node server run with plain `node`               | Only the dev command loads the preload; the app imports Prisma's entry if it is there |
| A bundled server (tsup, esbuild, Rollup, webpack) | The bundler puts the empty entries in the bundle (see below)                          |

There is no `if (import.meta.env.DEV)` around each call. In development, the real code comes from the
`development` condition: the Vite plugin and the preload add it, and a bundler adds it with its
`conditions` option.

### A bundled server

With plain imports, a production bundle gets the empty entries, and the package can be a dev
dependency. tsup bundles dev dependencies by default; with esbuild, Rollup or webpack, do not mark
`query-profiler` as external. Bundle for development with the `development` condition (esbuild's
`conditions: ["development"]`), and run that bundle with the preload:
`node --import query-profiler/register dist/server.js`. Importing
`formatProfile` from `query-profiler` itself keeps the core in the bundle, inert: leave it to the
development build.

## Usage with React Router

React Router 7.9+ or 8 in framework mode (also Remix, which is React Router now), Prisma 7 with
a driver adapter (the examples use `@prisma/adapter-pg`). Two files; nothing to remove before
deploying, and nothing in your routes.

**1. Add the Vite plugin**, before `reactRouter()`:

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { queryProfiler } from "query-profiler/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [queryProfiler({ log: true }), reactRouter()],
});
```

In development it profiles every request React Router answers, puts the bar on every page and
serves `/_profiler`. In builds it swaps every `query-profiler` import for its no-op entry.

| Option | Default      | What it does                                |
| ------ | ------------ | ------------------------------------------- |
| `base` | `/_profiler` | Where the profiler's page and API live.     |
| `log`  | `false`      | Print one line per request in the terminal. |

**2. Profile the Prisma client.** `withProfiler()` wraps the client's options, so every SQL
statement is recorded; `profilePrisma()` records each operation (`User.findMany`…) and the line
of your code that called it.

```ts
// app/db.server.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { profilePrisma, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
```

`profilePrisma()` applies a client extension, so the client gets its own type: where you typed it
as `PrismaClient`, use `typeof prisma`. Add your own extensions before it:
`profilePrisma(new PrismaClient(…).$extends(yours))`.

If you also send raw SQL with `pg`, share one pool and wrap it with `profilePool()`:

```ts
import pg from "pg";
import { profilePool } from "query-profiler/prisma";

export const pool = profilePool(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
const adapter = new PrismaPg(pool);
```

Run your dev server and open any page: the bar is at the bottom, and `/_profiler` has the full
view. The plugin adds a middleware to the Vite dev server, right before React Router's, that runs
each request inside its profile. The bar comes in with React Router's client entry in development
and learns its page's token from the page's `Server-Timing` header, so the calls the page makes
before the bar is there still hang under it. In a production build both steps do nothing, with no
`if (import.meta.env.DEV)` around them.

The bar sits at the bottom of every page and adds up the page and the calls it made: requests,
queries, time the database was busy and warnings. Click it to open:

- **Requests**: the page, and under it every call it made (fetchers, navigations, actions,
  revalidations). Each call is its own profile; the bar tags it with the page's token
  (`X-Debug-Parent`), so it hangs under the page. A client navigation starts a new page.
- **Queries** of the request you pick: N+1 groups collapsed, slow and duplicated ones marked.
  Open one to read its SQL laid out over lines and in colour, copy it runnable, and open the line in
  your editor.
- **Operations**, **Timeline**, **Warnings** and **Request**.

It updates live while its tab is visible, catches up when you come back to it, and lists recent requests, with **Clear** to remove them all. Minimize it to a pill, or open the full profile.

The bar and the profiler page are dark by default. The switch next to their name picks **Dark**,
**Light** or **Auto** (your system's); your browser keeps the choice for both.

## Usage with a Node server

Express, Fastify, Koa, Hapi, NestJS, Hono on `@hono/node-server`, or any server built on Node's
`http` module, with Prisma 7 and a driver adapter. Your server's code does not change. Three
steps, and nothing to remove before deploying.

**1. Install it as a dev dependency**: `npm i -D query-profiler`.

**2. Profile the Prisma client.** The package is only there in development, so import it only if it
is installed:

```ts
// src/db.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
// A dev dependency: a production install leaves it out, and the client stays plain.
const profiler = await import("query-profiler/prisma").catch(() => undefined);

export const prisma: Omit<PrismaClient, "$on"> = profiler
  ? profiler.profilePrisma(new PrismaClient(profiler.withProfiler({ adapter })))
  : new PrismaClient({ adapter });
```

**3. Add the preload to your dev command**, whatever runs it (`node --watch`, `tsx watch`, nodemon's
`--exec`, the Nest CLI's `--exec`, or `NODE_OPTIONS` for anything else):

```json
{
  "scripts": {
    "dev": "tsx watch --import query-profiler/register src/server.ts",
    "start": "node dist/server.js"
  }
}
```

`--import query-profiler/register` profiles each request from Node itself, before your framework
sees it, and gives your app's own imports of the profiler (`query-profiler/prisma`) its real code.
Without it, as in production, every entry does nothing.

Run the dev server. Once your app listens, the terminal says where the profiler is:

```txt
[query-profiler] http://localhost:4983/_profiler
```

Call your API and open it: every request, its SQL, the Prisma operations and the line of code
behind each, live. Each response's `X-Debug-Token` opens that request at `/_profiler/<token>`.

- `QUERY_PROFILER_PORT` picks the port (4983 by default). If it is busy, the profiler waits a second
  for a restarting app to let go of it, then takes the next free one and prints it.
- `QUERY_PROFILER_LOG=1` prints one line per request in the terminal.
- `QUERY_PROFILER_HOST=0.0.0.0` makes it listen on every interface, to reach it from outside a
  container with its port published. It still answers only requests addressed to a local host.
- Several processes share one profiler: with Node's `cluster`, PM2 in cluster mode, or two apps at
  once, the first one serves it and the others send it their requests. If it stops, another one
  takes the port over.
- When a request comes from another origin, the preload adds `X-Debug-Token` to
  `Access-Control-Expose-Headers`; if your CORS settings set that header themselves, list
  `X-Debug-Token` there too.
- Tested in CI with Express 4.18+ and 5, Fastify 4.26+ and 5, Koa 3, Hapi 21, NestJS 12 and Hono 4.
  Before 4.18, Express's body parser drops the request's async context, so a route that reads a
  body loses its queries. HTTP/2 servers are profiled on Node 22.17+ and 24.2+, without
  `X-Debug-Token`.
- If it is off, the terminal says why. Nothing at all, or an empty profiler: see
  [troubleshooting](https://query-profiler.dev/docs/guides/troubleshooting).

## The profiler page

`/_profiler` is the full view, the same data with room to read it:

- **Requests**: every recent request on the left, each page with its calls under it, filterable
  by path or status. On the right, the one you pick (`/_profiler/:token`): method, path, status and
  time; cards for queries, time in the database, operations and warnings; the calls it made; the
  same tabs as the bar; and its JSON to download.
- **Stats** (`/_profiler/stats`): across the stored requests, the slowest and the most repeated
  statement shapes, time by model and by route. On top, **Analyze the session ›** adds up the
  [query analysis](https://query-profiler.dev/docs/concepts/query-analysis#the-whole-session) of
  every distinct statement: the indexes to add, ranked by the time they would fix, what the rules
  find across the session, and the tables the time goes to.

**Clear**, next to Requests and Stats, removes every stored request. Every open tab with the
profiler or the bar empties its lists too; the bar keeps the page it is on.

A custom server that runs Vite in middleware mode, as React Router's templates for Express do, gets
the same: the plugin's middleware runs inside Vite's.

## Query analysis

Open a query in the Queries tab and press **Explain ›**: the profiler asks your database for the
query's plan, and reads it with rules written from each engine's manual (PostgreSQL, MySQL, MariaDB,
SQLite). Each finding comes with its fix, such as the `@@index` line for `schema.prisma`, and on
PostgreSQL and SQLite **Try this index** creates it in a transaction that is rolled back, to show
whether the database would use it. **Measure it** runs a read the same way, to show the rows and time
each step really had. No AI, and nothing leaves your machine: the plan comes from your database's own
planner. See [Query analysis](https://query-profiler.dev/docs/concepts/query-analysis) and
[every rule](https://query-profiler.dev/docs/reference/rules).

## HTTP API

Under `/_profiler`, answering only `localhost`, only in development: on the dev server for React
Router, and on the profiler's own port for a Node server. `/_profiler`,
`/_profiler/:token` and `/_profiler/stats` are the page; the rest is JSON:

| Route                                           | Returns                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/profiles?url=&kind=&parent=&limit=`   | Profiles, newest first, without their records                                                   |
| `GET /api/profiles/:token`                      | One profile, whole                                                                              |
| `GET /api/stream`                               | Server-sent events: one `profile` per finished request, and `clear` when the storage is emptied |
| `GET /api/meta`                                 | Where paths are shown from                                                                      |
| `POST /api/profiles`                            | Takes another process's finished profile, as JSON; refuses a request with an `Origin`           |
| `DELETE /api/profiles`                          | Empties the storage                                                                             |
| `GET /api/profiles/:token/findings`             | What each query's SQL shows without asking the database                                         |
| `GET /api/profiles/:token/queries/:id/analysis` | The query's plan, tables and findings; `?measure=1` to measure it. Needs `X-Query-Profiler`     |
| `POST /api/profiles/:token/queries/:id/trial`   | Tries an index the analysis suggested, by its name. Needs `X-Query-Profiler`                    |
| `GET /api/stats/analysis`                       | Every distinct statement of the stored requests analyzed, added up. Needs `X-Query-Profiler`    |

`createHandler()` is a plain Fetch handler (`Request` → `Response`), so any framework can mount it.
Every profiled response carries `X-Debug-Token`.

## Turning it off

It only runs in development: with `NODE_ENV=development`, or with `NODE_ENV` unset, as servers
without a bundler leave it. `NODE_ENV=production` or `test` keep it off, so your app's own
test runs are never profiled. `QUERY_PROFILER_DISABLED=1` turns it off in development too
(end-to-end suites, for one): requests are not profiled, the API answers 404 and the bar shows
nothing. Production builds resolve every package to its no-op entry, and plain `node` without the
preload does too.

## Security and privacy

- **Development only.** Production gets the no-op entries: builds through the Vite plugin, and
  plain `node` without the preload. Even the real code does nothing with `NODE_ENV`
  set to anything but `development` (`production`, `test`…).
- **Local only.** The API answers `localhost`, `127.0.0.1` and `[::1]`, even when the dev server
  listens on the network. For a Node server, the profiler's own port listens on `localhost` only.
  It takes profiles from other processes as JSON only and never with an `Origin`, so a page in your
  browser cannot send it any.
- **In memory only.** Profiles live in the dev server's memory: the last 100, at most 1000 queries
  each. Nothing is written to disk, to a database or to cookies; the browser keeps only how you
  left the bar.
- **Secrets.** Prisma arguments whose key looks like a secret (`password`, `token`, `apiKey`,
  `authorization`, `cookie`…) are shown as `[redacted]`, and so are the SQL parameters that carry
  them: those equal to such an argument, and those the SQL compares with or writes to a column named
  like one (`"password" = $1`, `INSERT INTO … ("password") VALUES ($2)`), raw SQL included. A secret
  bound some other way in raw SQL (inside a function call, say) still shows. Long strings are cut.

## Known limitations

- Profiles are lost when the dev server restarts, and each process keeps its own.
- The bar and the profiler page keep a server-sent events connection open while their tab is
  visible, and close it while it is hidden. Over HTTP/1.1 a browser allows six connections per
  host, so six windows of the same app side by side can still stall new requests.
- Query durations are measured from Node: they include the network and any wait for a pooled
  connection.

## Examples

Apps wired as this README describes, in [examples/](examples/):

| Example                                         | Stack                                      |
| ----------------------------------------------- | ------------------------------------------ |
| [react-router](examples/react-router/README.md) | React Router 8, Vite, Prisma 7, PostgreSQL |
| [fastify](examples/fastify/README.md)           | Fastify 5, Prisma 7, PostgreSQL            |
| [express](examples/express/README.md)           | Express 5, Prisma 7, PostgreSQL            |

From the root: `pnpm example:react-router`, `pnpm example:fastify` or `pnpm example:express`. Each example's README says how to set it up.

## Development

```sh
pnpm install        # also builds dist/
pnpm dev            # rebuilds dist/ on every change, for an app that links this folder
pnpm test
pnpm test:browser   # the bar and the page in Chromium (pnpm exec playwright install chromium)
pnpm check          # lint, format and types
pnpm website:dev    # the website (landing page and docs) at http://localhost:4321
```

CI runs lint, format and types, the tests against PostgreSQL, MySQL, MariaDB and SQLite on Node
22.19, 22 and 24 and on the
oldest and newest supported Prisma, and the browser tests.

The package ships compiled JavaScript from `dist/` (Node won't strip types inside
`node_modules`), with its declarations and source maps. The Prisma tests need a PostgreSQL:
set `QUERY_PROFILER_TEST_DATABASE_URL`, in the environment or in a `.env` file (default
`postgresql://postgres:postgres@localhost:5432/query_profiler_test`). The database name must end in
`_test`; it is created when missing.

### Releasing

1. Set the version in `package.json` (`0.x` while the API settles) and add it to
   [CHANGELOG.md](CHANGELOG.md).
2. Tag the commit and push the tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. The release workflow checks that the tag matches `package.json`, runs every check and test,
   stages the version on npm with provenance and creates the GitHub release.
4. Approve the staged version with two-factor authentication, on npmjs.com or with
   `npm stage list query-profiler` and `npm stage approve <id>`. Only then is it public.

The workflow uses npm's trusted publishing, with no token, and may only stage versions. The first version is
published by hand (`npm login`, then `npm publish`); after it, add this repository's
`release.yml` as the package's trusted publisher in its settings on npmjs.com.

## License

[MIT](LICENSE) © Jose Mojena
