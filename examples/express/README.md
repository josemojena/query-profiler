# Express example

Express 5, Prisma 7 and PostgreSQL, with query-profiler wired as the main
[README](../../README.md#usage-with-a-node-server) describes: the server's code knows nothing of
the profiler.

- `GET /users` lists users with one query per user, so the profiler flags an N+1.
- `GET /users/:id` loads a user with their posts.
- `POST /posts` creates a post from a JSON body (`{ "authorId": 1, "title": "Hello" }`).

## Run it

From the repository root:

```sh
pnpm install
cp examples/express/.env.example examples/express/.env   # then point DATABASE_URL at your PostgreSQL
pnpm --filter example-express db:setup    # the database, the Prisma client and six users
pnpm example:express
```

Call the API (`curl -i http://localhost:3000/users`): each response carries `X-Debug-Token`. The
terminal prints where the profiler is, http://localhost:4983/_profiler: open it for every request.
Set `QUERY_PROFILER_LOG=1` in `.env` to also print one line per request.

The seed runs through the same client, with the preload. With the server running, run it again:

```sh
pnpm --filter example-express db:seed
```

The terminal sums the run up, with the N+1 its loop of `create` calls makes, and links to it in the
profiler, next to the requests.

`pnpm example:express` builds query-profiler and gives the example a fresh copy of it, as npm would
install it. Run it again after changing the package.

## Where query-profiler goes

| File             | What it adds                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `package.json`   | `query-profiler` as a dev dependency; the `dev` script runs with the preload and its condition |
| `src/db.ts`      | The Prisma client with `withProfiler()` and `profilePrisma()`, when the package is installed   |
| `prisma/seed.ts` | Uses that client; `db:seed` runs it with the preload                                           |

It is set up as development only: `pnpm --filter example-express build` and `start` run plain `node`,
and a production install (`npm ci --omit=dev`) leaves the package out, so the app runs without it.
