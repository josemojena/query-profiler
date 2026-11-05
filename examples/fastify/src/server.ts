import Fastify from "fastify";
import { prisma } from "./db.js";

const app = Fastify();

// query-profiler is a dev dependency: a production install leaves it out, and the app runs without it.
const profiler = await Promise.all([
  import("query-profiler"),
  import("query-profiler/fastify"),
]).catch(() => undefined);
if (profiler) {
  const [{ formatProfile }, { profilerPlugin }] = profiler;
  await app.register(profilerPlugin, {
    onProfile: (profile) => console.log(formatProfile(profile)),
  });
}

// One query per user, on purpose: the profiler flags it as an N+1.
app.get("/users", async () => {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  return Promise.all(
    users.map(async (user) => ({
      ...user,
      posts: await prisma.post.count({ where: { authorId: user.id } }),
    })),
  );
});

app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
  const user = await prisma.user.findUnique({
    where: { id: Number(request.params.id) },
    include: { posts: true },
  });
  return user ?? reply.code(404).send({ error: "not_found" });
});

app.post<{ Body: { authorId: number; title: string } }>("/posts", async (request, reply) => {
  const post = await prisma.post.create({ data: request.body });
  return reply.code(201).send(post);
});

const address = await app.listen({ port: Number(process.env.PORT ?? 3000) });
console.log(`Listening on ${address}: try /users, and the profiler at /_profiler`);
