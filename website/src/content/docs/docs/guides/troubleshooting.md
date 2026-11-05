---
title: Troubleshooting
description: When a Node server's requests or queries do not show up in the profiler, and what to change.
---

For a [Node server](/docs/guides/node) run with the preload. Start with the terminal: the profiler
says where it is, or why it is off.

## The terminal says it is off

| It says                              | Change                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| `Off: NODE_ENV is "local"`           | Run development with `NODE_ENV=development`, or without `NODE_ENV`. |
| `Off: it needs Node 22.19+ or 24.5+` | Update Node: earlier versions break on what the preload needs.      |

In production, in test runs (`NODE_ENV=test`) and with `QUERY_PROFILER_DISABLED=1` it stays off
without a word: there, that is the point.

## The terminal says nothing

The preload is not loaded:

- **The flag never reaches Node.** Some runners start Node themselves: use their option for it
  (`--exec` in nodemon and the Nest CLI), or put it in `NODE_OPTIONS`. The
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
- **Several processes share one profiler**: Node's `cluster`, PM2 in cluster mode, or two apps run
  side by side. The first one serves it, and the others send it their requests; the terminal says
  `(shared with another process)`. To keep two apps apart, give each its own `QUERY_PROFILER_PORT`.
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

The profiler listens on `localhost` of the machine that runs the app.

**In a container** (Docker, a dev container), set `QUERY_PROFILER_HOST=0.0.0.0` so it listens on
every interface, and publish its port as you publish the app's:

```sh
docker run -e QUERY_PROFILER_HOST=0.0.0.0 -p 3000:3000 -p 4983:4983 my-app
```

```yaml
# compose.yaml
services:
  api:
    environment:
      QUERY_PROFILER_HOST: 0.0.0.0
    ports:
      - "3000:3000"
      - "4983:4983"
```

Then open `http://localhost:4983/_profiler` on your machine. It still answers only requests
addressed to a local host, so the network cannot read it. Keep its port fixed: if 4983 is busy inside
the container, the profiler takes the next one, which is not published. Set `QUERY_PROFILER_PORT` to
the port you publish.

**On another machine** (a VM, a remote dev server), forward the port over SSH, with no setting:

```sh
ssh -L 4983:localhost:4983 your-dev-machine
```

**Through an address with a name of its own**, such as a cloud editor's forwarded URL, it answers
404: it only answers local host names.
