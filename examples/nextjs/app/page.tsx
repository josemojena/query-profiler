import { Suspense } from "react";
import { prisma } from "../lib/db";
import { createPost } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const users = await prisma.user.count();
  return { title: `${users} users` };
}

// One query per user, on purpose: the profiler flags it as an N+1.
async function Users() {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const rows = await Promise.all(
    users.map(async (user) => ({
      ...user,
      posts: await prisma.post.count({ where: { authorId: user.id } }),
    })),
  );
  return (
    <ul>
      {rows.map((user) => (
        <li key={user.id}>
          {user.email}: {user.posts} posts
        </li>
      ))}
    </ul>
  );
}

// Streamed in after the page's first bytes.
async function LatestPosts() {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const posts = await prisma.post.findMany({ orderBy: { id: "desc" }, take: 3 });
  return <p>Latest: {posts.map((post) => post.title).join(", ")}</p>;
}

export default function Home() {
  return (
    <main>
      <h1>Users</h1>
      <Users />
      <Suspense fallback={<p>Loading the latest posts…</p>}>
        <LatestPosts />
      </Suspense>
      <form action={createPost}>
        <input name="title" defaultValue="Hello" />
        <button type="submit">Add a post</button>
      </form>
    </main>
  );
}
