---
title: Turning it off
description: When query-profiler runs, and how to switch it off.
---

query-profiler only runs in development: with `NODE_ENV=development`, or with `NODE_ENV` unset, as
servers without a bundler leave it. `NODE_ENV=production` or `test` keep it off, so your app's own
test runs are never profiled. In production every entry is its no-op version, through the Vite
plugin or because plain `node` runs without the preload and `--conditions=development`, so there is
nothing to turn off there.

In development, set `QUERY_PROFILER_DISABLED=1` to switch it off, for example in an end-to-end test
suite:

- requests are not profiled;
- the `/_profiler` API answers `404`;
- the bar shows nothing.

```ts
// playwright.config.ts
webServer: {
  command: "npm run dev",
  env: { QUERY_PROFILER_DISABLED: "1" },
},
```
