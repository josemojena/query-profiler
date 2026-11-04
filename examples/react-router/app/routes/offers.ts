import { prisma } from "../db.server";

export async function loader() {
  return prisma.offer.findMany({ include: { product: true }, orderBy: { discount: "desc" } });
}
