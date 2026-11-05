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

## Types

`profilePrisma()` applies a client extension, so the client gets its own type. Where you typed it as
`PrismaClient`, use `typeof prisma`. A transaction client is
`Parameters<Parameters<typeof prisma["$transaction"]>[0]>[0]`.

## Your own extensions

Add them before `profilePrisma()`:

```ts
export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })).$extends(yours));
```

## Raw SQL with `pg`

If you also send raw SQL with `pg`, share one pool and wrap it with `profilePool()`. A statement is
never recorded twice, even though Prisma's adapter uses the same pool.

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
