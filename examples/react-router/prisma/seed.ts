import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Enough rows that PostgreSQL plans as it would in production: with a handful, reading a whole
// table is cheaper than any index, and the profiler says so instead.
const USERS = 2000;
const POSTS = 60_000;
const NAMES = [
  "Ann",
  "Joanna",
  "Hannah",
  "Marco",
  "Lucía",
  "Noah",
  "Amara",
  "Kenji",
  "Ines",
  "Oscar",
];
const DAY = 24 * 60 * 60 * 1000;

await prisma.purchase.deleteMany();
await prisma.offer.deleteMany();
await prisma.product.deleteMany();
await prisma.post.deleteMany();
await prisma.user.deleteMany();
await prisma.$executeRaw`ALTER SEQUENCE "User_id_seq" RESTART WITH 1`;
await prisma.$executeRaw`ALTER SEQUENCE "Post_id_seq" RESTART WITH 1`;

await prisma.user.createMany({
  data: Array.from({ length: USERS }, (_, i) => ({
    email: `user${i + 1}@example.test`,
    name: `${NAMES[i % NAMES.length]} ${i + 1}`,
  })),
});
const start = Date.UTC(2026, 0, 1);
for (let from = 0; from < POSTS; from += 10_000)
  await prisma.post.createMany({
    data: Array.from({ length: 10_000 }, (_, at) => {
      const i = from + at;
      return {
        title: `Post ${i + 1}`,
        published: i % 3 !== 0,
        views: (i * 37) % 1000,
        createdAt: new Date(start + (i % 300) * DAY),
        authorId: 1 + (i % USERS),
      };
    }),
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
// Statistics now, as autovacuum would gather them after a while. A new connection, after the
// others closed: PostgreSQL counts their changed rows only once they report them, on closing.
const analyzer = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
await analyzer.$executeRaw`ANALYZE`;
await analyzer.$disconnect();
console.log(`Seeded ${USERS} users, ${POSTS} posts, and 6 products with offers and purchases.`);
