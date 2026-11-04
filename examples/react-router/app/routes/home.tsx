import { prisma } from "../db.server";
import type { Route } from "./+types/home";

// One query per user on purpose: the bar flags it as N+1.
export async function loader() {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const posts = await Promise.all(
    users.map((user) => prisma.post.count({ where: { authorId: user.id } })),
  );
  return { users: users.map((user, i) => ({ ...user, posts: posts[i] })) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-bold">Users</h1>
      <ul>
        {loaderData.users.map((user) => (
          <li key={user.id}>
            {user.email}: {user.posts} posts
          </li>
        ))}
      </ul>
    </main>
  );
}
