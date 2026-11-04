import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

await prisma.purchase.deleteMany();
await prisma.offer.deleteMany();
await prisma.product.deleteMany();
await prisma.post.deleteMany();
await prisma.user.deleteMany();
for (let i = 1; i <= 6; i++)
  await prisma.user.create({
    data: { email: `user${i}@example.test`, posts: { create: [{ title: `Post ${i}` }] } },
  });
const names = ["Keyboard", "Mouse", "Monitor", "Desk lamp", "Headphones", "Webcam"];
for (const [i, name] of names.entries())
  await prisma.product.create({
    data: {
      name,
      price: 20 + i * 15,
      offers: i % 2 === 0 ? { create: [{ discount: 10 + i }] } : undefined,
      purchases: { create: [{ quantity: 1 + i }] },
    },
  });
await prisma.$disconnect();
console.log("Seeded 6 users and 6 products with offers and purchases.");
