---
title: Fastify
description: Set up query-profiler in a Fastify 4.26+ or 5 API.
---

Fastify 4.26 or later, with Prisma 7 and `@prisma/adapter-pg`. Each response carries
`X-Debug-Token`, and `/_profiler` shows every request. Three steps, and nothing to remove before
deploying. A complete API is in
[`examples/fastify`](https://github.com/josemojena/query-profiler/tree/main/examples/fastify).

## 1. Install it, and run the dev server with the `development` condition

Without a bundler there is no build step to swap the profiler out, so install it as a regular
dependency. Node loads the real code only when started with `--conditions=development`; plain
`node`, as in production, gets the entry that does nothing.

```json
{
  "dependencies": { "query-profiler": "^0.2.0" },
  "scripts": {
    "dev": "tsx watch --conditions=development src/server.ts",
    "start": "node dist/server.js"
  }
}
```

`tsx`, `node --watch` and `nodemon` all take the flag.

## 2. Profile the Prisma client

The same as in any app: see [Prisma](/docs/guides/prisma).

```ts
// src/db.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { profilePrisma, withProfiler } from "query-profiler/prisma";
import { PrismaClient } from "./generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter })));
```

## 3. Register the plugin

Before your routes:

```ts
// src/server.ts
import Fastify from "fastify";
import { profilerPlugin } from "query-profiler/fastify";

const app = Fastify();
await app.register(profilerPlugin);
```

Call your API, then open `/_profiler` on the same server. To print one line per request in the
terminal:

```ts
import { formatProfile } from "query-profiler";

await app.register(profilerPlugin, {
  onProfile: (profile) => console.log(formatProfile(profile)),
});
```

| Option      | Default      | What it does                                                              |
| ----------- | ------------ | ------------------------------------------------------------------------- |
| `base`      | `/_profiler` | Where the profiler's page and API live. Requests to it are not profiled.  |
| `onProfile` | none         | Called with each profile once its response is sent, to log it or keep it. |

## How it fits in Fastify

It is a regular Fastify plugin, made with `fastify-plugin` so its hooks see every route of the app:

- `onRequest` opens a profile and runs the rest of the request inside it, body parsing included;
- `onSend` adds `X-Debug-Token`, and when the request comes from another origin, adds it to
  `Access-Control-Expose-Headers` so a frontend there can read it;
- `onResponse` (or `onRequestAbort`) closes the profile;
- `/_profiler` and its API are an ordinary route.
