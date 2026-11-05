---
title: Turning it off
description: When query-profiler runs, and how to switch it off.
---

query-profiler only runs with `NODE_ENV=development`. In a production build every entry is its no-op
version, so there is nothing to turn off there.

In development, set `QUERY_PROFILER_DISABLED=1` to switch it off, for example in an end-to-end test
suite:

- the middleware passes requests through untouched;
- the `/_profiler` API answers `404`;
- the bar shows nothing.

```ts
// playwright.config.ts
webServer: {
  command: "npm run dev",
  env: { QUERY_PROFILER_DISABLED: "1" },
},
```
