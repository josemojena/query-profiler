---
title: HTTP API
description: The routes under /_profiler and the headers on every profiled response.
---

Under `/_profiler`, answering only `localhost`, only in development: on the dev server for React
Router, and on the profiler's own port (`http://localhost:4983`) for a Node server. `/_profiler`,
`/_profiler/:token` and `/_profiler/stats` are the [page](/docs/concepts/profiler-page); the rest is
JSON.

| Route                                                    | Returns                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/profiles?url=&kind=&parent=&limit=`            | Profiles, newest first, without their records (50 by default)                                                                                                             |
| `GET /api/profiles/:token`                               | One profile, whole                                                                                                                                                        |
| `GET /api/stream`                                        | Server-sent events: one `profile` per finished request, `clear` when the storage is emptied, a ping every 15 s                                                            |
| `GET /api/stats`                                         | Stats across the stored profiles                                                                                                                                          |
| `GET /api/meta`                                          | The project root, to show short paths and open your editor                                                                                                                |
| `POST /api/profiles`                                     | Takes another process's profile, as JSON: finished, or a script's again as it grows, where the longer one stays. Refuses a request with an `Origin`                       |
| `DELETE /api/profiles`                                   | Empties the storage                                                                                                                                                       |
| `GET /api/profiles/:token/findings`                      | What each query's SQL and values show without asking the database, by query id                                                                                            |
| `GET /api/profiles/:token/queries/:id/analysis?measure=` | The query's plan (estimated, or measured with `measure=1`), its tables, and the findings. Needs `X-Query-Profiler`                                                        |
| `POST /api/profiles/:token/queries/:id/trial`            | Tries an index the analysis suggested, by its name (`{ "index": "Post_authorId_idx" }`), in a transaction rolled back. Needs `X-Query-Profiler`                           |
| `GET /api/stats/analysis`                                | Every distinct statement of the stored profiles, each planned once through its slowest run, added up: the indexes to add, the rules, the tables. Needs `X-Query-Profiler` |

`createHandler()` from `query-profiler` is a plain Fetch handler (`Request` → `Response`), so any
framework can mount it.

## Headers

| Header             | Where                                     | What                                                                                                     |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `X-Debug-Token`    | Every profiled response                   | The profile's token, to open it at `/_profiler/:token`                                                   |
| `X-Debug-Parent`   | Requests a page makes                     | The token of the page that made the call, so its profile hangs under it                                  |
| `X-Query-Profiler` | The analysis routes that ask the database | Any value. A page on another origin cannot send it without a preflight, which the profiler never answers |
