---
title: React Router
description: Set up query-profiler in a React Router 7.9+ or 8 app (also Remix).
---

React Router 7.9+ or 8 in framework mode, with Prisma 7 and `@prisma/adapter-pg`. Four files, and
nothing to remove before deploying. A complete app is in
[`examples/react-router`](https://github.com/josemojena/query-profiler/tree/main/examples/react-router).

## 1. Turn on middleware (React Router 7 only)

The profiler is a React Router middleware. In version 7 middleware is opt-in; in 8 it is always on.

```ts
// react-router.config.ts
import type { Config } from "@react-router/dev/config";

export default {
  future: { v8_middleware: true },
} satisfies Config;
```

## 2. Add the Vite plugin

Put it before `reactRouter()`. In development it serves the profiler under `/_profiler`; in builds it
swaps every `query-profiler` import for its no-op entry.

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { queryProfiler } from "query-profiler/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [queryProfiler(), reactRouter()],
});
```

## 3. Profile the Prisma client

```ts
// app/db.server.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { profilePrisma, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
```

The [Prisma guide](/docs/guides/prisma) explains both calls, raw SQL and types.

## 4. Add the middleware to the root route

It runs in Node only, so create it in a `.server` module: React Router keeps those out of the
browser bundle.

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

Run your dev server and open any page: the [bar](/docs/concepts/the-bar) is at the bottom, and
[`/_profiler`](/docs/concepts/profiler-page) has the full view.

## Options

`profilerMiddleware()` takes:

| Option      | Default      | What it does                                                                         |
| ----------- | ------------ | ------------------------------------------------------------------------------------ |
| `base`      | `/_profiler` | Where the profiler's pages and API live. Pass the same to `queryProfiler({ base })`. |
| `toolbar`   | `true`       | Add the bar to HTML pages.                                                           |
| `onProfile` | none         | Called with each profile once its response is sent, to log it or keep it.            |

To print one line per request in the terminal:

```ts
import { formatProfile } from "query-profiler";
import { profilerMiddleware } from "query-profiler/react-router";

export const dbProfiler = profilerMiddleware({
  onProfile: (profile) => console.log(formatProfile(profile)),
});
```

## Without Vite

With a custom server, mount `query-profiler/react-router/route` as a resource route at
`/_profiler/*`, pass `toolbar: false`, and render `<ProfilerToolbar />` from
`query-profiler/react-router/toolbar` in your layout.
