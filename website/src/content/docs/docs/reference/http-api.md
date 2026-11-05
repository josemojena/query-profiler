---
title: HTTP API
description: The routes under /_profiler and the headers on every profiled response.
---

Under `/_profiler`, answering only `localhost`, only in development. `/_profiler`,
`/_profiler/:token` and `/_profiler/stats` are the [page](/docs/concepts/profiler-page); the rest is
JSON.

| Route                                         | Returns                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /api/profiles?url=&kind=&parent=&limit=` | Profiles, newest first, without their records (50 by default)             |
| `GET /api/profiles/:token`                    | One profile, whole                                                        |
| `GET /api/stream`                             | Server-sent events: one `profile` per finished request, a ping every 15 s |
| `GET /api/stats`                              | Stats across the stored profiles                                          |
| `GET /api/meta`                               | The project root, to show short paths and open your editor                |
| `DELETE /api/profiles`                        | Empties the storage                                                       |

`createHandler()` from `query-profiler` is a plain Fetch handler (`Request` → `Response`), so any
framework can mount it.

## Headers

| Header           | Where                   | What                                                                    |
| ---------------- | ----------------------- | ----------------------------------------------------------------------- |
| `X-Debug-Token`  | Every profiled response | The profile's token, to open it at `/_profiler/:token`                  |
| `X-Debug-Parent` | Requests a page makes   | The token of the page that made the call, so its profile hangs under it |
