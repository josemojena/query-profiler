---
title: Installation
description: Requirements and installing query-profiler.
---

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

See [compatibility](/docs/reference/compatibility) for what is coming.

## Install

```sh
npm i -D query-profiler
```

Frameworks and drivers are optional peer dependencies, so installing it never pulls in Next.js,
React, Vite, Fastify or Express: it uses the ones your app already has.

## Development only, by construction

Every entry that runs inside your app has a `development` build with the real code and a
`default` one that does nothing, with the same API. How it stays out of production depends on how
you ship the server:

| How you ship                                      | Install it as  | What leaves the profiler out                                                   |
| ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| A Vite build (React Router)                       | dev dependency | The Vite plugin puts the empty entries in the build: production never needs it |
| A bundled server (tsup, esbuild, Rollup, webpack) | dev dependency | The bundler puts the empty entries in the bundle (see below)                   |
| Plain `node`, development only                    | dev dependency | The app imports it only if it is installed (see below)                         |
| Plain `node`, simplest                            | dependency     | Node loads the empty entries unless started with `--conditions=development`    |

Either way, there is no `if (import.meta.env.DEV)` around each call, and in development Node or the
bundler picks the real code with the `development` condition (`tsx watch --conditions=development`,
`node --conditions=development`, or the bundler's `conditions` option).

### Development only, without a bundler

Install it with `npm i -D query-profiler`, and import it only if it is there, so a production
install (`npm ci --omit=dev`) leaves it out and the app runs without it:

```ts
// src/server.ts
const profiler = await import("query-profiler/express").catch(() => undefined);
if (profiler) app.use(profiler.profilerMiddleware());
```

```ts
// src/db.ts
const profiler = await import("query-profiler/prisma").catch(() => undefined);

export const prisma: Omit<PrismaClient, "$on"> = profiler
  ? profiler.profilePrisma(new PrismaClient(profiler.withProfiler({ adapter })))
  : new PrismaClient({ adapter });
```

The same goes for `query-profiler/fastify`. The examples in `examples/express` and
`examples/fastify` are set up this way.

### A bundled server

With plain imports, a production bundle gets the empty entries, and the package can be a dev
dependency. tsup bundles dev dependencies by default; with esbuild, Rollup or webpack, do not mark
`query-profiler` as external. Bundle for development with the `development` condition (esbuild's
`conditions: ["development"]`). Importing `formatProfile` from `query-profiler` itself keeps the
core in the bundle, inert: leave it to the development build.

Next: set it up in [React Router](/docs/guides/react-router), [Fastify](/docs/guides/fastify) or [Express](/docs/guides/express).
