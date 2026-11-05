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
- Shown in a **bar at the bottom of your pages**, in a **full profiler page** and as JSON.

It is built for Prisma ORM and needs it: it hooks into Prisma's driver adapter and client
extensions. Raw SQL you send with `pg` next to Prisma is captured too. It runs only in development
and leaves nothing in production builds.

## Requirements

| What       | Supported                                                            |
| ---------- | -------------------------------------------------------------------- |
| Prisma ORM | **7.1 or later**, with `@prisma/adapter-pg`. Not 6; 8 is planned     |
| Database   | PostgreSQL (MySQL is planned)                                        |
| Node       | 20.19 or later                                                       |
| Raw SQL    | `pg` (node-postgres), optional                                       |
| Framework  | React Router 7.9+ and 8 in framework mode (also Remix), with Vite 6+ |
| Framework  | Fastify 4.26+ and 5                                                  |
| Framework  | Express 4.18+ and 5                                                  |

Prisma 6 is not supported: it has no SQL comments, and its query engine runs the driver adapter
outside the request's async context. Next.js, NestJS and other HTTP APIs (Express, Hono) are
planned: an adapter only opens and closes a profile per request; capture and the UI are shared.

query-profiler is an independent project, not affiliated with Prisma or React Router.

## Entry points

One package, one entry per integration. Import only the ones you use: the frameworks and drivers
are optional peer dependencies, so installing `query-profiler` never pulls in Next.js, React or Vite, and
an entry you don't import is never loaded.

| Import                        | What it does                                                                                      | Needs                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------- |
| `query-profiler`              | The `Profile` format, the per-request context, storage, analysis and the HTTP handler.            | nothing                     |
| `query-profiler/prisma`       | The Prisma ORM integration: every operation, its SQL and the line of code behind it.              | `@prisma/client` 7.1+, `pg` |
| `query-profiler/react-router` | Opens a profile per request in React Router 7.9+ and 8 (framework mode, also Remix).              | `react-router` 7.9+         |
| `query-profiler/express`      | An Express middleware: a profile per request, and the profiler's page and API under `/_profiler`. | `express` 4.18+             |
| `query-profiler/fastify`      | A Fastify plugin: a profile per request, and the profiler's page and API under `/_profiler`.      | `fastify` 4.26+             |
| `query-profiler/vite`         | Serves the profiler's API and UI from the Vite dev server, and keeps the profiler out of builds.  | `vite` 6+                   |
| `query-profiler/ui`           | The bar and the profiler page, as web components with their styles inside. No framework.          | a browser                   |

## How it works

- **Request context.** The adapter runs each request inside an `AsyncLocalStorage` scope that
  holds its profile.
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

With Vite it is a dev dependency. Each entry that runs inside your app has a `development` build
with the real code and a `default` one that does nothing: dev servers use the first, production
builds get the second, inlined by the Vite plugin, so a deploy with `npm ci --omit=dev` never needs
it. Without a bundler, as with Fastify or Express, install it as a dependency instead (`npm i query-profiler`):
Node loads the real code only when started with `--conditions=development`.

## Usage with React Router

React Router 7.9+ or 8 in framework mode (also Remix, which is React Router now), Prisma 7 with
`@prisma/adapter-pg`. Four files; nothing to remove before deploying.

**1. Turn on middleware (React Router 7 only).** The profiler is a React Router middleware; in
version 7 those are opt-in, in 8 they are always on:

```ts
// react-router.config.ts
import type { Config } from "@react-router/dev/config";

export default {
  future: { v8_middleware: true },
} satisfies Config;
```

**2. Add the Vite plugin**, before `reactRouter()`. In development it serves the profiler under
`/_profiler`; in builds it swaps every `query-profiler` import for its no-op entry.

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { queryProfiler } from "query-profiler/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [queryProfiler(), reactRouter()],
});
```

**3. Profile the Prisma client.** `withProfiler()` wraps the client's options, so every SQL
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

**4. Add the middleware to the root route.** It runs in Node only, so create it in a `.server`
module: React Router keeps those out of the browser bundle.

```ts
// app/profiler.server.ts
import { profilerMiddleware } from "query-profiler/react-router";

export const dbProfiler = profilerMiddleware();
```

```tsx
// app/root.tsx
import type { Route } from "./+types/root";
import { dbProfiler } from "./profiler.server";

export const middleware: Route.MiddlewareFunction[] = [dbProfiler];
```

Run your dev server and open any page: the bar is at the bottom, and `/_profiler` has the full
view. The middleware opens a profile per request and adds the bar to every HTML page after it has
loaded, so React's hydration never sees it. In a production build all four steps do nothing, with
no `if (import.meta.env.DEV)` around them.

`profilerMiddleware()` takes:

| Option      | Default      | What it does                                                                         |
| ----------- | ------------ | ------------------------------------------------------------------------------------ |
| `base`      | `/_profiler` | Where the profiler's pages and API live. Pass the same to `queryProfiler({ base })`. |
| `toolbar`   | `true`       | Add the bar to HTML pages.                                                           |
| `onProfile` | none         | Called with each profile once its response is sent, to log it or keep it.            |

To print one line per request in the terminal:

```ts
import { formatProfile } from "query-profiler";

export const dbProfiler = profilerMiddleware({
  onProfile: (profile) => console.log(formatProfile(profile)),
});
```

The bar sits at the bottom of every page and adds up the page and the calls it made: requests,
queries, time the database was busy and warnings. Click it to open:

- **Requests**: the page, and under it every call it made (fetchers, navigations, actions,
  revalidations). Each call is its own profile; the bar tags it with the page's token
  (`X-Debug-Parent`), so it hangs under the page. A client navigation starts a new page.
- **Queries** of the request you pick: N+1 groups collapsed, slow and duplicated ones marked,
  copy the runnable SQL, open the line in your editor.
- **Operations**, **Timeline**, **Warnings** and **Request**.

It updates live while its tab is visible, catches up when you come back to it, and lists recent requests. Minimize it to a pill, or open the full profile.

## Usage with Fastify

Fastify 4.26 or later, Prisma 7 with `@prisma/adapter-pg`. For APIs: each response carries
`X-Debug-Token`, and `/_profiler` shows every request. Three steps; nothing to remove before
deploying.

**1. Install it as a dependency, and run the dev server with the `development` condition.** Node
picks the real code only with that flag; plain `node`, as in production, gets the entry that does
nothing.

```sh
npm i query-profiler
```

```json
{
  "scripts": {
    "dev": "tsx watch --conditions=development src/server.ts",
    "start": "node dist/server.js"
  }
}
```

**2. Profile the Prisma client**, as for React Router:

```ts
// src/db.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { profilePrisma, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
```

**3. Register the plugin**, before your routes:

```ts
// src/server.ts
import Fastify from "fastify";
import { profilerPlugin } from "query-profiler/fastify";

const app = Fastify();
await app.register(profilerPlugin);
```

Call your API, then open `/_profiler` on the same server: every request, its SQL, the Prisma
operations and the line of code behind each, live. Each response's `X-Debug-Token` opens that
request at `/_profiler/<token>`, and `onProfile` with `formatProfile()` prints one line per request.

It is a regular Fastify plugin (made with `fastify-plugin`), so it sees every route of the app.
It takes `base` and `onProfile`, like `profilerMiddleware()`. When a request comes from another
origin, it adds `X-Debug-Token` to `Access-Control-Expose-Headers`, so a frontend there can read it.

## Usage with Express

Express 4.18 or later, 5 included, with Prisma 7 and `@prisma/adapter-pg`. Set up as for Fastify:
install the package as a dependency, run the dev server with `--conditions=development` and
profile the Prisma client (steps 1 and 2 above). Then add the middleware, **first**:

```ts
// src/server.ts
import express from "express";
import { profilerMiddleware } from "query-profiler/express";

const app = express();
app.use(profilerMiddleware());
app.use(express.json());
```

It runs the rest of each request, body parsing and routes included, inside the request's profile,
and serves `/_profiler`. It takes `base` and `onProfile`. When a request comes from another
origin, it adds `X-Debug-Token` to `Access-Control-Expose-Headers`; if you use `cors` with its own
`exposedHeaders`, add the middleware after it, or list `X-Debug-Token` there too. Before 4.18,
Express's body parser drops the request's async context, so a route that reads a body loses its
queries.

## The profiler page

`/_profiler` is the full view, the same data with room to read it:

- **Requests**: every recent request on the left, each page with its calls under it, filterable
  by path or status. On the right, the one you pick (`/_profiler/:token`): method, path, status and
  time; cards for queries, time in the database, operations and warnings; the calls it made; the
  same tabs as the bar; and its JSON to download.
- **Stats** (`/_profiler/stats`): across the stored requests, the slowest and the most repeated
  statement shapes, time by model and by route.

Without Vite (a custom server), mount `query-profiler/react-router/route` at `/_profiler/*`, pass
`toolbar: false` and render `<ProfilerToolbar />` from `query-profiler/react-router/toolbar` in your layout.

## HTTP API

Under `/_profiler`, answering only `localhost`, only in development. `/_profiler`,
`/_profiler/:token` and `/_profiler/stats` are the page; the rest is JSON:

| Route                                         | Returns                                                |
| --------------------------------------------- | ------------------------------------------------------ |
| `GET /api/profiles?url=&kind=&parent=&limit=` | Profiles, newest first, without their records          |
| `GET /api/profiles/:token`                    | One profile, whole                                     |
| `GET /api/stream`                             | Server-sent events: one `profile` per finished request |
| `GET /api/meta`                               | Where paths are shown from                             |
| `DELETE /api/profiles`                        | Empties the storage                                    |

`createHandler()` is a plain Fetch handler (`Request` → `Response`), so any framework can mount it.
Every profiled response carries `X-Debug-Token`.

## Turning it off

It only runs in development: with `NODE_ENV=development`, or with `NODE_ENV` unset, as servers
without a bundler (Fastify, Express) leave it. `NODE_ENV=production` or `test` keep it off, so your app's own
test runs are never profiled. `QUERY_PROFILER_DISABLED=1` turns it off in development too
(end-to-end suites, for one): the middleware passes through, the API answers 404 and the bar shows
nothing. Production builds resolve every package to its no-op entry, and plain `node` without
`--conditions=development` does too.

## Security and privacy

- **Development only.** Production gets the no-op entries: builds through the Vite plugin, and
  plain `node` without `--conditions=development`. Even the real code does nothing with `NODE_ENV`
  set to anything but `development` (`production`, `test`…).
- **Local only.** The API answers `localhost`, `127.0.0.1` and `[::1]`, even when the dev server
  listens on the network.
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

One app per supported framework, each wired as this README describes, in [examples/](examples/):

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

CI runs lint, format and types, the tests against PostgreSQL on Node 20, 22 and 24 and on the
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
