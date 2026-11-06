---
title: Scripts, workers and jobs
description: Profile a seed, a one-off script, a queue worker, a server's startup and the work between requests.
---

A seed, a one-off script, a timer in your server or a queue worker query the database outside any
request. They are where N+1 loops are most common, and nobody watches them. Run them with the
[preload](/docs/guides/node) and they are profiled too.

They need the profiled client, as your server does: import your app's `prisma` (built with
`withProfiler()` and `profilePrisma()`, see [Prisma](/docs/guides/prisma)) instead of creating a
plain one in the script.

## Scripts and seeds

Add the preload to the command that runs the script:

```json
{
  "scripts": {
    "db:seed": "tsx --import query-profiler/register prisma/seed.ts"
  }
}
```

`node --import query-profiler/register scripts/backfill.js` does the same for plain JavaScript. A
process that never listens is a script, and its whole run is one profile. When it ends, the
terminal sums it up: one line, each warning with the line of code behind it, and a link to it.

```txt
[query-profiler] script prisma/seed.ts · 32 queries · 33.58 ms in db · 8 operations · 3 warnings · 102.11 ms · 3b9cfe
  N+1        User.create, 6 times  prisma/seed.ts:6
  http://localhost:4983/_profiler/3b9cfe
```

The link is there when your app's dev server is running: the script finds its profiler and sends
the run there, so you read it with the same tabs as a request, Explain included.

- A long script shows in the profiler while it still runs, and grows there as it goes.
- A script that ends with `process.exit()` gets there too.
- With React Router, the Vite plugin also opens the profiler's own port (4983, or
  `QUERY_PROFILER_PORT`) for scripts to reach it. You keep using `/_profiler` on your app's port.
- With no dev server running, the terminal summary is all you get.

A profile keeps its first 1,000 queries and counts the rest. A seed that inserts 60,000 rows one at
a time says how many it ran, and its N+1 shows the loop: one `createMany` would do.

## A server's startup

What a server does before it listens (loading settings, warming a cache) is a profile of its own,
**startup**, named after the file the server runs. Its requests come after it, each in its own.

## Work between requests

A `setInterval`, a queue consumer in the same process, or work left running after a response was
sent: queries made outside any request go into **background** profiles.

- One opens with the first query, and closes once nothing has run for 200 ms. A query still running
  keeps it open.
- It is named after the line of code that started it, such as `src/jobs/cleanup.ts:9`.
- The profiler keeps the last 20, so a job that runs every second does not push your requests out.
- The bar leaves them out of **Recent**, and `/_profiler` opens on the newest profile that is not one.

## A job's own profile: `profileTask()`

Bursts are a good guess. For exact boundaries, wrap each run of a job in `profileTask()`: it gets a
profile of its own, named as you say, as a request has.

```ts
import { profileTask } from "query-profiler/prisma";

new Worker("emails", (job) => profileTask(`send-email ${job.id}`, () => sendEmail(job.data)));
```

- It returns what your function returns, and rethrows what it throws. The profile is kept either way.
- Outside development it only runs your function, like every other entry: nothing to remove before
  deploying.
- A worker that runs tasks counts as serving, as a server that listens does: what it did before its
  first task is its startup, and what runs between tasks goes into background profiles.

Run the worker with the preload, as a script. Its tasks go to the profiler your app's dev server
serves; with none running, they are not kept anywhere you can read them.

## How they look

In `/_profiler`, they are listed with the requests. Where a request has its method and status, they
have what they are (`script`, `startup`, `task` or `background`) in a grey pill, next to their name.
Their **Run** tab, in place of **Request**, says what ran.
