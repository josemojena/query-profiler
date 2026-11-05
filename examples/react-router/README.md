# React Router example

React Router 8, Vite, Prisma 7 and PostgreSQL, with query-profiler wired as the main
[README](../../README.md#usage-with-react-router) describes.

- `/` lists users with one query per user, so the bar flags an N+1.
- `/products` loads the products, then offers and purchases from two `useFetcher` calls on mount;
  «Buy» posts with a fetcher. The bar hangs every one of those calls under the page.

## Run it

From the repository root:

```sh
pnpm install
cp examples/react-router/.env.example examples/react-router/.env   # then point DATABASE_URL at your PostgreSQL
pnpm --filter example-react-router db:setup    # the database, the Prisma client and six users
pnpm example:react-router
```

Open http://localhost:5173: the bar is at the bottom of the page, and `/_profiler` has the full
view. Each request is also printed in the terminal.

`pnpm example:react-router` builds query-profiler and gives the example a fresh copy of it, as npm would
install it. Run it again after changing the package.

## Where query-profiler goes

| File               | What it adds                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `vite.config.ts`   | `queryProfiler({ log: true })`, before `reactRouter()`: a profile per request, the bar on every page, one line per request |
| `app/db.server.ts` | The Prisma client with `withProfiler()` and `profilePrisma()`                                                              |

Nothing else: no middleware, no change to `root.tsx`. A build gets none of the profiler, so it is a
dev dependency.
