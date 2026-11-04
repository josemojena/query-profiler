# Spike: capture and request context

Validated on 2026-11-04 with Prisma 7.10, `@prisma/adapter-pg`, `pg` 8.23, React Router 7.18 and
Node 26, against PostgreSQL. Tests: `test/prisma/capture.test.ts`.

| Question                                                                                               | Result                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the request context (`AsyncLocalStorage`) reach every statement Prisma sends through its adapter? | Yes. Two concurrent requests keep their statements apart.                                                                                                                                                   |
| Does it reach raw SQL on the same pool?                                                                | Yes, through `pool.query` and through checked-out clients.                                                                                                                                                  |
| Does an operation's context, set with `als.run()` around `query(args)`, reach its statements?          | No. Prisma runs the query after the extension returns.                                                                                                                                                      |
| With `enterWith()` instead?                                                                            | Yes, and it does not leak into the code that runs after the call.                                                                                                                                           |
| Batch transactions (`$transaction([...])`)                                                             | Prisma runs the whole batch in the context of its first operation. The sqlcommenter stamp names the right one.                                                                                              |
| Compacted `findUnique` (one statement for several calls)                                               | The stamp says `compacted`; the statement is linked to all of them.                                                                                                                                         |
| Interactive transactions                                                                               | Statements keep their operation; `BEGIN`/`COMMIT` are grouped by connection.                                                                                                                                |
| Does the sqlcommenter plugin see the operation's context?                                              | Only with `enterWith()`. The stamp therefore carries `Model.action`, not an id.                                                                                                                             |
| Where in the app did it come from?                                                                     | Operations: the awaiting frame, through V8 async stack traces and source maps (Vite SSR maps to the `.ts` file). Raw SQL: captured at `pool.query`.                                                         |
| Streaming responses                                                                                    | The profile ends when the body has been sent, so deferred data is included.                                                                                                                                 |
| Production builds                                                                                      | Middleware gated on `import.meta.env.DEV` and `sideEffects: false`: gone. A lazy `import()` of the capture package (about 10 KB) stays in the server bundle and never loads. A build plugin will remove it. |

Notes:

- Prisma promises are lazy: the query runs where it is awaited, so that is the context it gets.
- Prisma sends some parameters as strings (`OFFSET` as `"0"`); they are recorded as sent.
- Summing the duration of concurrent statements overstates database time. The summary should
  measure the time the database was busy instead.
