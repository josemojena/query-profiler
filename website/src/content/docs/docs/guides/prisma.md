---
title: Prisma client
description: How query-profiler hooks into Prisma 7, raw SQL and your own extensions.
---

Two calls profile a Prisma 7 client:

```ts
export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
```

- **`withProfiler(options)`** wraps the client's options. It profiles the driver adapter, so every
  SQL statement Prisma sends is recorded with its parameters and duration, and adds a SQL comment
  plugin that stamps each statement with the operation it answers. The stamp is removed before the
  SQL is shown.
- **`profilePrisma(client)`** adds a client extension that records each operation
  (`User.findMany`, `Order.create`…) with its arguments, and takes the line of your code that made
  each call when the call is made.

## Databases

Prisma 7 talks to the database through a driver adapter, and `withProfiler()` wraps whichever you
pass. Each of these is tested with the same checks:

| Database          | Adapter                          | Tested on               |
| ----------------- | -------------------------------- | ----------------------- |
| PostgreSQL        | `@prisma/adapter-pg`             | 18                      |
| MySQL and MariaDB | `@prisma/adapter-mariadb`        | MySQL 8.4, MariaDB 11.4 |
| SQLite            | `@prisma/adapter-better-sqlite3` | the bundled SQLite      |

```ts
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
// or: import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
// or: const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });

export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
```

MySQL, MariaDB and SQLite bind parameters with `?` instead of `$1`: secrets are hidden the same way,
and "Copy runnable SQL" fills them in order.

## Development only, without a bundler

When `query-profiler` is a dev dependency of a server run with plain `node`, import it only if it
is installed, so a production install leaves it out and the client stays plain:

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

Typing `prisma` as `Omit<PrismaClient, "$on">` covers both branches. With Vite or a bundled server,
keep the plain imports above: the build gets the empty entries (see
[installation](/docs/installation)).

## Types

`profilePrisma()` applies a client extension, so the client gets its own type. Where you typed it as
`PrismaClient`, use `typeof prisma`. A transaction client is
`Parameters<Parameters<typeof prisma["$transaction"]>[0]>[0]`.

## Your own extensions

Add them before `profilePrisma()`:

```ts
export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })).$extends(yours));
```

## Raw SQL

`$queryRaw` and `$executeRaw` go through Prisma's adapter, so they are recorded on every database.

If you also send raw SQL with `pg`, share one pool and wrap it with `profilePool()`. A statement is
never recorded twice, even though Prisma's adapter uses the same pool. SQL you send with your own
MySQL or SQLite driver (`mysql2`, `better-sqlite3` used directly) is not recorded.

```ts
import pg from "pg";
import { profilePool } from "query-profiler/prisma";

export const pool = profilePool(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
const adapter = new PrismaPg(pool);
```

## What gets linked

- **Transactions** (interactive and batch) keep their `BEGIN`, `COMMIT` or `ROLLBACK` and a shared
  transaction id.
- **Batches and compacted queries**: when Prisma runs `$transaction([…])` or merges several
  `findUnique` into one statement, the stamp assigns each statement to the right operations.
- **Raw queries** (`$queryRaw`, `$executeRaw`) are operations too, with their line of code.
