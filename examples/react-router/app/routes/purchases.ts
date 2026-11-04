import { prisma } from "../db.server";
import type { Route } from "./+types/purchases";

export async function loader() {
  return prisma.purchase.findMany({
    include: { product: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  return prisma.purchase.create({
    data: { productId: Number(form.get("productId")), quantity: 1 },
  });
}
