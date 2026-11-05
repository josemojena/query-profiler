---
title: How it works
description: The pieces of query-profiler and the life of a request.
---

## One profile per request

The integration (for React Router, the Vite plugin's dev-server middleware) opens a **profile** when a request starts
and runs the rest of the request inside an `AsyncLocalStorage` scope that holds it. Whatever Prisma
or `pg` does while that request is in flight, however many promises and callbacks away, lands in
that profile. Outside a request (a script, a job) nothing is recorded.

The profile closes when the **last byte of the response is sent**, not when the loader returns, so
streamed and deferred data count too. Then it is analyzed and stored.

## Three capture points

| What                 | Where it hooks                              | What it adds                                            |
| -------------------- | ------------------------------------------- | ------------------------------------------------------- |
| The Prisma operation | `profilePrisma()`, a client extension       | `User.findMany`, its arguments, the line that called it |
| The SQL Prisma sends | `withProfiler()`, around the driver adapter | The exact SQL, parameters, duration, transaction        |
| Raw SQL through `pg` | `profilePool()`, on the pool                | The same, for what does not go through Prisma           |

`@prisma/adapter-pg` uses the same `pg` pool, so while one layer records a statement, the layer below
lets it through: nothing is counted twice.

## Linking SQL to its operation

The async context says which operation is running, and is right almost always. Prisma breaks that in
two cases: a batch transaction runs every statement in the context of its first operation, and
several `findUnique` calls can be compacted into one statement. So `withProfiler()` adds a SQL
comment plugin that stamps each statement with the operation it answers:

```sql
SELECT "id", "email" FROM "User" /*query_profiler='User.findMany'*/
```

The stamp settles the link and is removed before the SQL is shown.

## The line of your code

Prisma runs a call when it is awaited, not when it is made, and Node before 26 loses the caller's
stack across that gap. `profilePrisma()` takes the line when the call is made and carries it in the
async context to the operation.

## Where profiles live

In the **dev server's memory**: the last 100 profiles, at most 1000 queries each. Nothing goes to
disk, a database or cookies. Profiles are lost when the dev server restarts, and each process keeps
its own. The bar and the profiler page read them through the [HTTP API](/docs/reference/http-api)
and hear about new ones over server-sent events.
