"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../lib/db";

export async function createPost(formData: FormData) {
  const author = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (!author) return;
  await prisma.post.create({ data: { authorId: author.id, title: String(formData.get("title")) } });
  revalidatePath("/");
}
