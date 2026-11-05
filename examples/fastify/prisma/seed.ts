import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

await prisma.post.deleteMany();
await prisma.user.deleteMany();
for (let i = 1; i <= 6; i++)
  await prisma.user.create({
    data: { email: `user${i}@example.test`, posts: { create: [{ title: `Post ${i}` }] } },
  });
await prisma.$disconnect();
console.log("Seeded 6 users with a post each.");
