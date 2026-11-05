---
title: Express
description: Set up query-profiler in an Express 4.18+ or 5 app.
---

Express 4.18 or later, 5 included, with Prisma 7 and `@prisma/adapter-pg`. Each response carries
`X-Debug-Token`, and `/_profiler` shows every request. Three steps, and nothing to remove before
deploying. A complete app is in
[`examples/express`](https://github.com/josemojena/query-profiler/tree/main/examples/express).

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

## 2. Profile the Prisma client

The same as in any app: see [Prisma](/docs/guides/prisma).

## 3. Add the middleware, first

```ts
// src/server.ts
import express from "express";
import { profilerMiddleware } from "query-profiler/express";

const app = express();
app.use(profilerMiddleware());
app.use(express.json());
```

It runs the rest of each request, body parsing and routes included, inside the request's profile,
names the route that answered (`/users/:id`) and serves `/_profiler`.

| Option      | Default      | What it does                                                              |
| ----------- | ------------ | ------------------------------------------------------------------------- |
| `base`      | `/_profiler` | Where the profiler's page and API live. Requests to it are not profiled.  |
| `onProfile` | none         | Called with each profile once its response is sent, to log it or keep it. |

## Seeing what your API did

As with [Fastify](/docs/guides/fastify#seeing-what-your-api-did): the page at `/_profiler`, the
`X-Debug-Token` on each response (open `/_profiler/<token>`), one line per request in the terminal
with `onProfile: (profile) => console.log(formatProfile(profile))`, and the JSON API.

## CORS

When a request comes from another origin, the middleware adds `X-Debug-Token` to
`Access-Control-Expose-Headers`, so a frontend there can read it. If you use `cors` with its own
`exposedHeaders`, add the profiler after it, or list `X-Debug-Token` there too.

## Versions

Before Express 4.18, its body parser drops the request's async context: a route that reads a body
runs outside its profile, and its queries are lost.
