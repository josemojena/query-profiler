---
title: Security and limits
description: What query-profiler keeps, where, who can see it, and what it does not do yet.
---

## Security and privacy

- **Development only.** Production gets the no-op entries: builds through the Vite plugin, and
  plain `node` without the preload and `--conditions=development`. Even the real code does nothing with `NODE_ENV`
  set to anything but `development` (`production`, `test`…).
- **Local only.** The API answers `localhost`, `127.0.0.1` and `[::1]`, even when the dev server
  listens on the network. For a Node server, the profiler's own port listens on `localhost` only.
- **In memory only.** The last 100 profiles, at most 1000 queries each, in the dev server's memory.
  Nothing is written to disk, to a database or to cookies; the browser keeps only how you left the
  bar.
- **Secrets.** Prisma arguments whose key looks like a secret (`password`, `token`, `apiKey`,
  `authorization`, `cookie`…) are shown as `[redacted]`, and so are the SQL parameters that carry
  them: those equal to such an argument, and those the SQL compares with or writes to a column named
  like one (`"password" = $1`, `INSERT INTO … ("password") VALUES ($2)`), raw SQL included. A secret
  bound some other way in raw SQL (inside a function call, say) still shows. Long strings are cut.

## Known limitations

- Profiles are lost when the dev server restarts, and each process keeps its own.
- Each browser tab with the bar keeps a server-sent events connection open. Over HTTP/1.1 a browser
  allows six per host, so many open tabs of the same app can stall new requests.
- Query durations are measured from Node: they include the network and any wait for a pooled
  connection.
