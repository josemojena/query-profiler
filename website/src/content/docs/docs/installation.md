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

With Vite (React Router) it is a **dev dependency**. Without a bundler (Fastify, Express), install it as a
regular dependency, `npm i query-profiler`: see [Fastify](/docs/guides/fastify). Frameworks and
drivers are optional peer dependencies, so installing it never pulls in Next.js, React, Vite or
Fastify or Express: it uses the ones your app already has.

## Development only, by construction

Each entry that runs inside your app has two builds: a `development` one with the real code and a
`default` one that does nothing, with the same API. Dev servers use the first; production builds get
the second, inlined by the Vite plugin. Without a bundler, Node picks the real one only when started
with `--conditions=development`. Either way, there is no `if (import.meta.env.DEV)` to write.

Next: set it up in [React Router](/docs/guides/react-router), [Fastify](/docs/guides/fastify) or [Express](/docs/guides/express).
