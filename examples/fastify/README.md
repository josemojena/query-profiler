# Fastify example

Fastify 5, Prisma 7 and PostgreSQL, with query-profiler wired as the main
[README](../../README.md#usage-with-a-node-server) describes: the server's code knows nothing of
the profiler.

- `GET /users` lists users with one query per user, so the profiler flags an N+1.
- `GET /users/:id` loads a user with their posts.
- `POST /posts` creates a post from a JSON body (`{ "authorId": 1, "title": "Hello" }`).

## Run it

From the repository root:

```sh
pnpm install
cp examples/fastify/.env.example examples/fastify/.env   # then point DATABASE_URL at your PostgreSQL
pnpm --filter example-fastify db:setup    # the database, the Prisma client and six users
pnpm example:fastify
```

Call the API (`curl -i http://localhost:3000/users`): each response carries `X-Debug-Token`. The
terminal prints where the profiler is, http://localhost:4983/_profiler: open it for every request.
Set `QUERY_PROFILER_LOG=1` in `.env` to also print one line per request.

`pnpm example:fastify` builds query-profiler and gives the example a fresh copy of it, as npm would
install it. Run it again after changing the package.

## Where query-profiler goes

| File           | What it adds                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `package.json` | `query-profiler` as a dev dependency; the `dev` script runs with the preload and its condition |
| `src/db.ts`    | The Prisma client with `withProfiler()` and `profilePrisma()`, when the package is installed   |

It is set up as development only: `pnpm --filter example-fastify build` and `start` run plain `node`,
and a production install (`npm ci --omit=dev`) leaves the package out, so the app runs without it.
