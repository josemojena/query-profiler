---
title: NestJS
description: Set up query-profiler in a NestJS 12 app, with the Nest CLI's dev command and the Prisma client as a provider.
---

NestJS 12: CI runs it on `@nestjs/platform-express`, its default platform, and
`@nestjs/platform-fastify` works the same way. Follow [Setup](/docs/guides/node), with two changes:
the preload goes through the Nest CLI, and the Prisma client is a provider.

## The dev command

The Nest CLI starts Node itself: give it the preload with `--exec`.

```json
{
  "scripts": {
    "start:dev": "nest start --watch --exec \"node --import query-profiler/register\"",
    "start:prod": "node dist/main"
  }
}
```

When `--watch` restarts the app, the profiler comes back on the same port.

## The Prisma client, as a provider

A Nest app compiles to CommonJS, where the `await` at the top of
[Setup's `db.ts`](/docs/guides/node#2-profile-the-prisma-client) does not compile. Load the
profiler in a provider's factory instead:

```ts
// src/prisma.provider.ts
import type { Provider } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export const prismaProvider: Provider = {
  provide: PrismaClient,
  useFactory: async () => {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    // A dev dependency: a production install leaves it out, and the client stays plain.
    const profiler = await import("query-profiler/prisma").catch(() => undefined);
    return profiler
      ? profiler.profilePrisma(new PrismaClient(profiler.withProfiler({ adapter })))
      : new PrismaClient({ adapter });
  },
};
```

Put it in a module's `providers` (and its `exports`, to share it), and inject the client as usual:
`constructor(private readonly prisma: PrismaClient) {}`. It takes the place of a `PrismaService`
that extends `PrismaClient`: `profilePrisma()` returns a new client, which a subclass cannot be.

## CORS

`app.enableCors()` hands its options to Express's `cors` or to `@fastify/cors`. A page on another
origin can read `X-Debug-Token`: the preload exposes it. If you set `exposedHeaders`, your list
replaces it, so add the token there:

```ts
app.enableCors({ origin: "http://localhost:5173", exposedHeaders: ["X-Debug-Token"] });
```

In production no response carries it, so the extra name does nothing.
