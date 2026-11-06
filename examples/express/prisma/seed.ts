import { prisma } from "../src/db.js";

await prisma.post.deleteMany();
await prisma.user.deleteMany();
for (let i = 1; i <= 6; i++)
  await prisma.user.create({
    data: { email: `user${i}@example.test`, posts: { create: [{ title: `Post ${i}` }] } },
  });
await prisma.$disconnect();
console.log("Seeded 6 users with a post each.");
