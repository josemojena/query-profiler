import { prisma } from "../db.server";
import type { Route } from "./+types/problems";

// Each query here has a problem the profiler's analysis finds. Open /_profiler, pick this
// request, open a query and press Explain plan.
const PROBLEMS: { what: string; look: string; run: () => Promise<unknown> }[] = [
  {
    what: "A filter on a column with no index",
    look: "Reads every row of Post: Try this index, and copy @@index([title])",
    run: () => prisma.post.findMany({ where: { title: "Post 4242" } }),
  },
  {
    what: "A relation loaded through a foreign key with no index",
    look: "The posts are found by authorId, which has no index; About the table Post says why",
    run: () =>
      prisma.user.findMany({ where: { email: "user42@example.test" }, include: { posts: true } }),
  },
  {
    what: "contains with mode: insensitive",
    look: "ILIKE, which no B-tree index serves: the fix is a trigram index",
    run: () => prisma.user.findMany({ where: { name: { contains: "anna", mode: "insensitive" } } }),
  },
  {
    what: "A search too short for any index",
    look: "Fewer than three characters: not even a trigram index helps",
    run: () => prisma.user.findMany({ where: { name: { contains: "an", mode: "insensitive" } } }),
  },
  {
    what: "endsWith",
    look: "LIKE with % first: the fix is a trigram index",
    run: () => prisma.post.findMany({ where: { title: { endsWith: "4242" } } }),
  },
  {
    what: "orderBy and take, with no index in that order",
    look: "Sorts every matching row to return ten: @@index([published, views(sort: Desc)])",
    run: () =>
      prisma.post.findMany({ where: { published: true }, orderBy: { views: "desc" }, take: 10 }),
  },
  {
    what: "A deep skip",
    look: "Skips 20,000 rows to return 20: page with a cursor",
    run: () => prisma.post.findMany({ orderBy: { id: "asc" }, skip: 20_000, take: 20 }),
  },
  {
    what: "Paging with no ORDER BY (raw SQL; Prisma orders skip by the id itself)",
    look: "Pages can repeat or miss rows",
    run: () => prisma.$queryRaw`SELECT id FROM "Post" LIMIT ${20} OFFSET ${40}`,
  },
  {
    what: "Counting every row",
    look: "count() reads the whole table on every call",
    run: () => prisma.post.count(),
  },
  {
    what: "A filter on the second column of an index",
    look: "PostgreSQL 18 skips through (published, createdAt), since published has two values: nothing to fix. On 17 or older it reads every row",
    run: () => prisma.post.findMany({ where: { createdAt: { gte: new Date("2026-10-20") } } }),
  },
  {
    what: "A huge IN list",
    look: "IN with 1,500 values",
    run: () =>
      prisma.post.findMany({
        where: { authorId: { in: Array.from({ length: 1500 }, (_, i) => i + 1) } },
        take: 5,
      }),
  },
  {
    what: "A function on a filtered column (raw SQL)",
    look: "lower() hides email from its index: the fix is an expression index",
    run: () => prisma.$queryRaw`SELECT id FROM "User" WHERE lower(email) = ${"user7@example.test"}`,
  },
  {
    what: "NOT IN over a subquery (raw SQL)",
    look: "Returns nothing if the subquery has a NULL: NOT EXISTS",
    run: () =>
      prisma.$queryRaw`SELECT id FROM "User" WHERE id NOT IN (SELECT "authorId" FROM "Post" WHERE views > ${990})`,
  },
  {
    what: "NOT IN with a NULL (raw SQL)",
    look: "Never true: no rows, ever",
    run: () => prisma.$queryRaw`SELECT id FROM "User" WHERE id NOT IN (${1}, NULL)`,
  },
];

export async function loader() {
  const counts: number[] = [];
  for (const problem of PROBLEMS) {
    const result = await problem.run();
    counts.push(Array.isArray(result) ? result.length : Number(result));
  }
  return { problems: PROBLEMS.map(({ what, look }, i) => ({ what, look, rows: counts[i] })) };
}

export default function Problems({ loaderData }: Route.ComponentProps) {
  return (
    <main className="grid gap-4 p-8">
      <a href="/" className="underline">
        Users
      </a>
      <h1 className="text-2xl font-bold">Queries with problems</h1>
      <p>
        Open{" "}
        <a href="/_profiler" className="underline">
          /_profiler
        </a>
        , pick this request, open a query and press <b>Explain plan</b>.
      </p>
      <ol className="grid list-decimal gap-2 pl-6">
        {loaderData.problems.map((problem) => (
          <li key={problem.what}>
            <b>{problem.what}</b> ({problem.rows} rows): {problem.look}
          </li>
        ))}
      </ol>
    </main>
  );
}
