# Fastify example

Fastify 5, Prisma 7 and PostgreSQL, with query-profiler wired as the main
[README](../../README.md#usage-with-fastify) describes.

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

Call the API (`curl -i http://localhost:3000/users`): each response carries `X-Debug-Token`, and
each request is printed in the terminal. Open http://localhost:3000/_profiler for the full view.

`pnpm example:fastify` builds query-profiler and gives the example a fresh copy of it, as npm would
install it. Run it again after changing the package.

## Where query-profiler goes

| File            | What it adds                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| `package.json`  | `query-profiler` as a dependency; the `dev` script runs with `--conditions=development` |
| `src/db.ts`     | The Prisma client with `withProfiler()` and `profilePrisma()`                           |
| `src/server.ts` | `app.register(profilerPlugin)`, printing one line per request                           |

`pnpm --filter example-fastify build` and `start` run plain `node`, which loads the profiler's empty
entry: nothing of it runs in production.
