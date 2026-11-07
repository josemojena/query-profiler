---
title: Fastify
description: Set up query-profiler in a Fastify 4.26+ or 5 app, through the preload, HTTP/2 included.
---

Fastify 4.26 and later, 5 included: CI runs it on 4.26.0, 5.0.0 and the newest. Your server's code
does not change: follow [Setup](/docs/guides/node) to install the package, profile the Prisma client
and add the preload. A complete app, Fastify 5 with an N+1 to find, is in
[`examples/fastify`](https://github.com/josemojena/query-profiler/tree/main/examples/fastify).

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

## HTTP/2

`Fastify({ http2: true })` is profiled on Node 22.17+ and 24.2+, where Node publishes HTTP/2
requests too, and CI runs it. Its responses carry no `X-Debug-Token`: find the request on the
profiler's page.

## CORS

With [`@fastify/cors`](https://www.npmjs.com/package/@fastify/cors), a page on another origin can
read `X-Debug-Token`: the preload exposes it. If you set `exposedHeaders`, your list replaces it, so
add the token there:

```ts
await app.register(cors, { origin: "http://localhost:5173", exposedHeaders: ["X-Debug-Token"] });
```

In production no response carries it, so the extra name does nothing.
