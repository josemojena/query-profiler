# Express example

Express 5, Prisma 7 and PostgreSQL, with query-profiler wired as the main
[README](../../README.md#usage-with-express) describes.

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

Call the API (`curl -i http://localhost:3000/users`): each response carries `X-Debug-Token`, and
each request is printed in the terminal. Open http://localhost:3000/_profiler for the full view.

`pnpm example:express` builds query-profiler and gives the example a fresh copy of it, as npm would
install it. Run it again after changing the package.

## Where query-profiler goes

| File            | What it adds                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `package.json`  | `query-profiler` as a dev dependency; the `dev` script runs with `--conditions=development`          |
| `src/db.ts`     | The Prisma client with `withProfiler()` and `profilePrisma()`, when the package is installed         |
| `src/server.ts` | `app.use(profilerMiddleware())`, first, when the package is installed, printing one line per request |

It is set up as development only: `pnpm --filter example-express build` and `start` run plain `node`,
and a production install (`npm ci --omit=dev`) leaves the package out, so the app runs without it.
