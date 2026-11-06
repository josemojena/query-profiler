---
title: Warnings
description: The rules behind N+1, slow and duplicate warnings, and the time in the database.
---

Warnings are computed once, when a request's profile closes. Transaction control statements
(`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`…) never count.

| Warning       | When                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **N+1**       | 5 or more statements with the same shape in one request               |
| **Duplicate** | The same SQL with the same parameters more than once                  |
| **Slow**      | A statement that took 100 ms or more                                  |
| **Truncated** | The request went over 1000 statements, and the rest were not recorded |

## Fixing an N+1

An N+1 row in the Queries tab, and the N+1 warning, have **Fix the N+1 ›**. It opens a tab in the
query's tools that says what repeats, which value changes each time and, when it can tell, which
earlier query those values came from. Then the code that replaces the loop, best first, each with
the queries it saves and **Copy**:

| The loop                              | The fix                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `count` by one key                    | `_count` in the query the keys came from, or one `groupBy`               |
| `findUnique`, `findMany` by one key   | `include` in the query the keys came from, or one `findMany` with `in`   |
| `create`                              | `createMany`; for nested creates, `createManyAndReturn` and `createMany` |
| `update` with the same data, `delete` | `updateMany`, `deleteMany`                                               |

On a page that lists six users and counts each one's posts, the fix keeps the users' query and adds
one line, in green:

```ts
prisma.user.findMany({
  orderBy: { id: "asc" },
  take: 6,
  include: { _count: { select: { posts: true } } }, // 1 query instead of 7
});
```

- **Where the values came from.** The earlier query is the one that returned one row per call of
  the loop, on the model the relation points to.
- **The relation's name** (`posts` here) is in your `schema.prisma`: Prisma's client does not expose
  it. The profiler reads the schema where `prisma.config.ts` says, or in `prisma/schema.prisma` or
  `prisma/schema/`, from the working directory up to the repository root, then in a monorepo's
  packages, and reads it again when it changes. Without it, the fix with `in` or `groupBy` still
  shows.
- **When no single query replaces the loop**, it says so: each update writes other values, each call
  pages on its own with `take`, or a hidden secret might differ from one call to the next.
- **The counts are what Prisma sends**: an `include` of a relation adds one query, an `include` of
  `_count` none, and a `create` with a nested one runs five statements (`BEGIN` and `COMMIT`
  included).

## The shape of a statement

To tell that two statements are "the same query with other values", each one is normalized: comments
are removed, string literals, `$1` placeholders and numbers become `?`, and an `IN (?, ?, ?)` list
becomes `(?)`. The result is hashed into a fingerprint.

```sql
SELECT COUNT(*) FROM "Post" WHERE "authorId" = $1 LIMIT 1
SELECT COUNT(*) FROM "Post" WHERE "authorId" = 42 LIMIT 1
-- both: SELECT COUNT(*) FROM "Post" WHERE "authorId" = ? LIMIT ?
```

## Time in the database

When queries run in parallel, adding up their durations says more than the database did. The
**in DB** figure joins overlapping intervals and counts each stretch once: the time the database was
actually busy.

Durations are measured from Node, from sending a statement to its answer: they include the network
and any wait for a pooled connection.
