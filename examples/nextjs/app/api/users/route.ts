import { prisma } from "../../../lib/db";

export async function GET() {
  return Response.json(await prisma.user.findMany({ include: { posts: true } }));
}
