# Next.js example

Next.js 16 (App Router), Prisma 7 and PostgreSQL, with query-profiler.

- `/` lists users with one query per user (an N+1 on purpose), counts them in `generateMetadata`,
  streams the latest posts through Suspense, and adds a post with a Server Action.
- `/posts` is reached with a client navigation.
- `/api/users` is a Route Handler.

## Run it

From the repository root:

```sh
pnpm install
cp examples/nextjs/.env.example examples/nextjs/.env   # then point DATABASE_URL at your PostgreSQL
pnpm --filter example-nextjs db:setup    # the database, the Prisma client and six users
pnpm example:nextjs
```

Open http://localhost:3000: the bar is at the bottom of the page, `/_profiler` has the full view,
and each request is printed in the terminal.

## Where query-profiler goes

| File                                   | What it adds                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `package.json`                         | `"dev": "query-profiler-next dev"`: Next's own `next dev`, every option kept        |
| `lib/db.ts`                            | The Prisma client with `withProfiler()` and `profilePrisma()`                       |
| `app/layout.tsx`                       | `<ProfilerToolbar />`                                                               |
| `app/%5Fprofiler/[[...path]]/route.ts` | The profiler's page and API (`%5F` is how Next names a folder that starts with `_`) |

`next build` and `next start` are untouched: production gets none of the profiler.
