---
title: Koa
description: Set up query-profiler in a Koa 3 app, through the preload.
---

Koa 3: CI runs it with `@koa/router` and `@koa/bodyparser`, and a route that reads a large JSON body
keeps its profile. Your server's code does not change: follow [Setup](/docs/guides/node) to install
the package, profile the Prisma client and add the preload.

## The dev command

```json
{
  "scripts": {
    "dev": "tsx watch --import query-profiler/register src/server.ts",
    "start": "node dist/server.js"
  }
}
```

In plain JavaScript, `node --watch --import query-profiler/register src/server.js`. Other watchers
are in [Setup](/docs/guides/node#3-add-the-preload-to-your-dev-command).

## CORS

With [`@koa/cors`](https://www.npmjs.com/package/@koa/cors), a page on another origin can read
`X-Debug-Token`: the preload exposes it. If you set `exposeHeaders`, your list replaces it, so add
the token there:

```ts
app.use(cors({ origin: "http://localhost:5173", exposeHeaders: ["X-Debug-Token"] }));
```

In production no response carries it, so the extra name does nothing.
