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

See [compatibility](/docs/reference/compatibility) for what is coming.

## Install

```sh
npm i -D query-profiler
```

It is a **dev dependency**. Frameworks and drivers are optional peer dependencies, so installing it
never pulls in Next.js, React or Vite: it uses the ones your app already has.

## Development only, by construction

Each entry that runs inside your app has two builds: a `development` one with the real code and a
`default` one that does nothing, with the same API. Dev servers use the first; production builds get
the second, inlined by the Vite plugin. A deploy with `npm ci --omit=dev` never needs the package,
and there is no `if (import.meta.env.DEV)` to write.

Next: set it up in [React Router](/docs/guides/react-router).
