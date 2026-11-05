---
title: Fastify
description: Set up query-profiler in a Fastify 4.26+ or 5 API.
---

Fastify 4.26 or later, with Prisma 7 and `@prisma/adapter-pg`. Each response carries
`X-Debug-Token`, and `/_profiler` shows every request. Three steps, and nothing to remove before
deploying. A complete API is in
[`examples/fastify`](https://github.com/josemojena/query-profiler/tree/main/examples/fastify).

## 1. Install it, and run the dev server with the `development` condition

Without a bundler there is no build step to swap the profiler out. Install it as a dev dependency
and import it only if it is there, so a production install leaves it out (see
[development only, without a bundler](/docs/installation#development-only-without-a-bundler)); or
install it as a regular dependency and use plain imports, as below: plain `node` then loads the
entry that does nothing. Either way, Node loads the real code only when started with
`--conditions=development`.

```sh
npm i -D query-profiler   # or npm i query-profiler
```

```json
{
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

Call your API, then open `/_profiler` on the same server (see below). To print one line per request
in the terminal:

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

## Seeing what your API did

An API has no pages to put the bar on, so the profiler shows up in four places:

- **The profiler page.** Open `http://localhost:3000/_profiler` in a browser: every request to your
  API on the left, live; on the right, the one you pick, with its SQL, its Prisma operations and the
  line of your code behind each, the N+1 groups and the warnings. Your Fastify serves it: there is
  nothing to build or host. See [the profiler page](/docs/concepts/profiler-page).
- **The token on each response.** Every response carries `X-Debug-Token`. When you call the API
  with curl, Postman or Bruno, open `/_profiler/<token>` to land on that request.
- **The terminal.** With `onProfile` and `formatProfile()`, one line per request:

  ```
  [query-profiler] GET /users 200 · 7 queries · 17.25 ms in db · 7 operations · 1 warning · 18.78 ms · 8de7fd
  ```

- **JSON.** `/_profiler/api/profiles` lists the requests and `/_profiler/api/profiles/<token>`
  returns one whole, for your own scripts: see the [HTTP API](/docs/reference/http-api).

## How it fits in Fastify

It is a regular Fastify plugin, made with `fastify-plugin` so its hooks see every route of the app:

- `onRequest` opens a profile and runs the rest of the request inside it, body parsing included;
- `onSend` adds `X-Debug-Token`, and when the request comes from another origin, adds it to
  `Access-Control-Expose-Headers` so a frontend there can read it;
- `onResponse` (or `onRequestAbort`) closes the profile;
- `/_profiler` and its API are an ordinary route.
