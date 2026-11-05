import Link from "next/link";
import { prisma } from "../../lib/db";

export const dynamic = "force-dynamic";

export default async function Posts() {
  const posts = await prisma.post.findMany({ include: { author: true }, orderBy: { id: "desc" } });
  return (
    <main>
      <h1>Posts</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            {post.title}, by {post.author.email}
          </li>
        ))}
      </ul>
      <Link href="/">Users</Link>
    </main>
  );
}
