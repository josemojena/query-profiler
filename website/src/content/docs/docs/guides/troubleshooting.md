---
title: Troubleshooting
description: When a Node server's requests or queries do not show up in the profiler, and what to change.
---

For a [Node server](/docs/guides/node) run with the preload. Start with the terminal: the profiler
says where it is, or why it is off.

## The terminal says it is off

| It says                                                                      | Change                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Off: add --conditions=development next to --import query-profiler/register` | Add the flag to the dev command: without it, Node loads the profiler's empty version. |
| `Off: NODE_ENV is "local"`                                                   | Run development with `NODE_ENV=development`, or without `NODE_ENV`.                   |

In production, in test runs (`NODE_ENV=test`) and with `QUERY_PROFILER_DISABLED=1` it stays off
without a word: there, that is the point.

## The terminal says nothing

The preload is not loaded:

- **The flags never reach Node.** Some runners start Node themselves: use their option for it
  (`--exec` in nodemon and the Nest CLI), or put both flags in `NODE_OPTIONS`. The
  [guide](/docs/guides/node#3-add-the-preload-to-your-dev-command) has each one.
- **`Cannot find package 'query-profiler'`**: Node looks for the preload from the folder the command
  runs in. In a monorepo, install `query-profiler` in the package that runs the server, as well as
  in the one that builds the Prisma client.
- **Your server never listens.** The profiler opens its port once the app's server does, so a
  script or a worker with no server gets none.

## The profiler is empty, but the app answers

- **Another process answers.** If the app's responses carry no `X-Debug-Token`, the request reached
  another program. An old dev server can still hold the port: on macOS, a server listening on all
  addresses starts even when another one holds `localhost` on the same port. Check with
  `lsof -nP -iTCP:3000 -sTCP:LISTEN`.
- **You opened another profiler.** If 4983 was busy, the profiler took the next free port, and the
  terminal printed it.
- **Several processes serve the app**: Node's `cluster`, PM2 in cluster mode, several workers. Each
  one has its own profiler, on 4983, 4984…, and the requests are spread among them. Run one process
  in development.
- **HTTP/2.** It is profiled on Node 22.17+ and 24.2+ only, and its responses carry no
  `X-Debug-Token`: find them on the profiler's page.
- **The server is not built on Node's `http` module** (uWebSockets.js, HyperExpress), or the app
  runs on **Bun** or **Deno**: not supported.

## A request shows, but not its queries

- **The queries run elsewhere**: in a worker thread (Piscina, `serverless-offline`), a job queue or
  a child process. Only what runs in the request's own async context is part of it.
- **The async context is lost on the way.** Before Express 4.18, its body parser loses it. Old
  promise libraries (Bluebird) and code that queues callbacks to run later, outside the request,
  can lose it too.
- **The Prisma client is not profiled**: it was built without `withProfiler()` and
  `profilePrisma()`, or another client is in use. See [Prisma](/docs/guides/prisma).
- **The query ran after the response was sent.** A profile closes with its response.

## Queries land in the wrong request

**GraphQL with DataLoader** batches the loads of several requests into one query, which runs in the
first request's context: it is recorded there.

## The line of code points to compiled files

The profiler follows each compiled file's source map, inline or in a `.map` file. Turn them on when
you compile (`"sourceMap": true` in `tsconfig.json`), or the lines point to `dist/`.

## The browser cannot reach the profiler

The profiler listens on `localhost` only, on the machine that runs the app. From a container or
another machine, it cannot be reached yet.
