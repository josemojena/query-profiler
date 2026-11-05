---
title: Installation
description: Requirements and installing query-profiler.
---

## Requirements

| What       | Supported                                                            |
| ---------- | -------------------------------------------------------------------- |
| Prisma ORM | **7.1 or later**, with `@prisma/adapter-pg`. Not 6; 8 is planned     |
| Database   | PostgreSQL (MySQL is planned)                                        |
| Node       | 22.15 or later                                                       |
| Raw SQL    | `pg` (node-postgres), optional                                       |
| Framework  | React Router 7.9+ and 8 in framework mode (also Remix), with Vite 6+ |
| Framework  | Any Node server: Express, Fastify, Koa, Hapi, NestJS, Hono           |

See [compatibility](/docs/reference/compatibility) for what is coming.

## Install

```sh
npm i -D query-profiler
```

Frameworks and drivers are optional peer dependencies, so installing it never pulls in React, Vite
or a server framework: it uses the ones your app already has.

## Development only, by construction

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

### A Node server without a bundler

The server's code needs nothing: the [preload](/docs/guides/node) in the dev command profiles each
request. The Prisma client imports `query-profiler/prisma` only if it is installed, so a production
install (`npm ci --omit=dev`) leaves the package out and the app runs without it:

```ts
// src/db.ts
const profiler = await import("query-profiler/prisma").catch(() => undefined);

export const prisma: Omit<PrismaClient, "$on"> = profiler
  ? profiler.profilePrisma(new PrismaClient(profiler.withProfiler({ adapter })))
  : new PrismaClient({ adapter });
```

The examples in `examples/express` and `examples/fastify` are set up this way.

### A bundled server

With plain imports, a production bundle gets the empty entries, and the package can be a dev
dependency. tsup bundles dev dependencies by default; with esbuild, Rollup or webpack, do not mark
`query-profiler` as external. Bundle for development with the `development` condition (esbuild's
`conditions: ["development"]`), and run that bundle with the preload:
`node --import query-profiler/register dist/server.js`. Importing
`formatProfile` from `query-profiler` itself keeps the core in the bundle, inert: leave it to the
development build.

Next: set it up in [React Router](/docs/guides/react-router) or a [Node server](/docs/guides/node).
