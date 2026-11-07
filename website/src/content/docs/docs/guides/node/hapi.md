---
title: Hapi
description: Set up query-profiler in a Hapi 21 app, through the preload.
---

Hapi 21 (`@hapi/hapi`), tested in CI. Your server's code does not change: follow
[Setup](/docs/guides/node) to install the package, profile the Prisma client and add the preload.

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

With CORS on, Hapi always sends its own `Access-Control-Expose-Headers`
(`WWW-Authenticate,Server-Authorization` by default), which replaces the preload's: a page on
another origin cannot read `X-Debug-Token`. Add it to Hapi's list:

```ts
const server = Hapi.server({
  port: 3000,
  routes: {
    cors: { origin: ["http://localhost:5173"], additionalExposedHeaders: ["X-Debug-Token"] },
  },
});
```

In production no response carries it, so the extra name does nothing.
