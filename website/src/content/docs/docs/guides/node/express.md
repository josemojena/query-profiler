---
title: Express
description: Set up query-profiler in an Express 4.18+ or 5 app, through the preload.
---

Express 4.18 and later, 5 included: CI runs it on 4.18.0, 5.0.0 and the newest. Your server's code
does not change: follow [Setup](/docs/guides/node) to install the package, profile the Prisma client
and add the preload. A complete app, Express 5 with an N+1 to find, is in
[`examples/express`](https://github.com/josemojena/query-profiler/tree/main/examples/express).

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

## Before Express 4.18

Its body parser loses the request's async context: a route that reads a body runs outside its
profile, and its queries land in a background profile instead. Update to 4.18 or later.

## CORS

With the [`cors`](https://www.npmjs.com/package/cors) middleware, a page on another origin can read
`X-Debug-Token`: the preload exposes it. If you set `exposedHeaders`, your list replaces it, so add
the token there:

```ts
app.use(
  cors({ origin: "http://localhost:5173", exposedHeaders: ["X-Total-Count", "X-Debug-Token"] }),
);
```

In production no response carries it, so the extra name does nothing.
