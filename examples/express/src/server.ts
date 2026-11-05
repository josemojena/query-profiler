import express from "express";
import { prisma } from "./db.js";

const app = express();

// query-profiler is a dev dependency: a production install leaves it out, and the app runs without it.
const profiler = await Promise.all([
  import("query-profiler"),
  import("query-profiler/express"),
]).catch(() => undefined);
if (profiler) {
  const [{ formatProfile }, { profilerMiddleware }] = profiler;
  app.use(profilerMiddleware({ onProfile: (profile) => console.log(formatProfile(profile)) }));
}
app.use(express.json());

// One query per user, on purpose: the profiler flags it as an N+1.
app.get("/users", async (_request, response) => {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  response.json(
    await Promise.all(
      users.map(async (user) => ({
        ...user,
        posts: await prisma.post.count({ where: { authorId: user.id } }),
      })),
    ),
  );
});

app.get("/users/:id", async (request, response) => {
  const user = await prisma.user.findUnique({
    where: { id: Number(request.params.id) },
    include: { posts: true },
  });
  if (user) response.json(user);
  else response.status(404).json({ error: "not_found" });
});

app.post("/posts", async (request, response) => {
  const body = request.body as { authorId: number; title: string };
  response.status(201).json(await prisma.post.create({ data: body }));
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () =>
  console.log(`Listening on http://localhost:${port}: try /users, and the profiler at /_profiler`),
);
