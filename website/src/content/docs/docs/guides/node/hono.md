---
title: Hono
description: Set up query-profiler in a Hono 4 app on Node, through @hono/node-server and the preload.
---

Hono 4 on Node, served by `@hono/node-server` 2, tested in CI. Your server's code does not change:
follow [Setup](/docs/guides/node) to install the package, profile the Prisma client and add the
preload. On Bun, Deno or Cloudflare Workers there is no Node server to profile: not supported.

## The dev command

```json
{
  "scripts": {
    "dev": "tsx watch --import query-profiler/register src/index.ts",
    "start": "node dist/index.js"
  }
}
```

In plain JavaScript, `node --watch --import query-profiler/register src/index.js`. Other watchers
are in [Setup](/docs/guides/node#3-add-the-preload-to-your-dev-command).

## CORS

With Hono's [`cors()`](https://hono.dev/docs/middleware/builtin/cors) middleware, a page on another
origin can read `X-Debug-Token`: the preload exposes it. If you set `exposeHeaders`, your list
replaces it, so add the token there:

```ts
app.use(cors({ origin: "http://localhost:5173", exposeHeaders: ["X-Debug-Token"] }));
```

In production no response carries it, so the extra name does nothing.
