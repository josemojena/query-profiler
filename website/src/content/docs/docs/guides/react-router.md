---
title: React Router
description: Set up query-profiler in a React Router 7.9+ or 8 app (also Remix).
---

React Router 7.9+ or 8 in framework mode, with Prisma 7 and a driver adapter. Two files, nothing
in your routes, and nothing to remove before deploying. A complete app is in
[`examples/react-router`](https://github.com/josemojena/query-profiler/tree/main/examples/react-router).

```sh
npm i -D query-profiler
```

It is a dev dependency: the build gets none of it.

## 1. Add the Vite plugin

Put it before `reactRouter()`:

```ts
// vite.config.ts
import { reactRouter } from "@react-router/dev/vite";
import { queryProfiler } from "query-profiler/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [queryProfiler({ log: true }), reactRouter()],
});
```

| Option | Default      | What it does                                |
| ------ | ------------ | ------------------------------------------- |
| `base` | `/_profiler` | Where the profiler's page and API live.     |
| `log`  | `false`      | Print one line per request in the terminal. |

## 2. Profile the Prisma client

```ts
// app/db.server.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { profilePrisma, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
```

The [Prisma guide](/docs/guides/prisma) explains both calls, raw SQL and types.

Run your dev server and open any page: [the bar](/docs/concepts/the-bar) is at the bottom, and
`/_profiler` has [the full view](/docs/concepts/profiler-page).

## How it fits in React Router

Nothing goes in your routes, and React Router 7 needs no `future.v8_middleware`:

- In development, the plugin adds a middleware to the Vite dev server, right before React Router's.
  It opens a profile for each request and runs the rest of it inside, so every loader, action and
  query lands in it. It tags each response with `X-Debug-Token`, and with a `Server-Timing` entry
  that carries the same token.
- The bar comes in with React Router's client entry (yours, `app/entry.client.tsx`, or its default
  one), added by the plugin in development only. It reads its page's token from the page's
  `Server-Timing` header before the app hydrates, so the fetchers a page runs on mount already hang
  under it.
- In a build, the plugin swaps every `query-profiler` import for its no-op entry, and adds nothing
  to the client.

A custom server that runs Vite in middleware mode, as React Router's Express template does, gets the
same: the plugin's middleware runs inside Vite's.
