import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSchema, readSchema } from "../../src/analysis/schema.js";

const BLOG = `
// The blog: https://example.test/docs
model User {
  id    Int    @id @default(autoincrement())
  email String @unique // "quoted" in a comment
  site  String @default("https://example.test") // a // in a string is no comment
  posts Post[] @relation("Written")
  liked Post[] @relation(name: "Liked")
  @@map("users")
}

model Post {
  id       Int   @id
  authorId Int
  author   User  @relation("Written", fields: [authorId], references: [id])
  fanId    Int?
  fan      User? @relation(name: "Liked", fields: [fanId], references: [id], onDelete: Cascade)
}

enum Role {
  ADMIN
}
`;

describe("reading a schema", () => {
  it("reads each model's fields, lists, optional ones and both sides of each relation", () => {
    const { models } = readSchema(BLOG);
    expect(models.map((model) => model.name)).toEqual(["User", "Post"]);
    const [user, post] = models;
    expect(user!.fields.map((field) => field.name)).toEqual([
      "id",
      "email",
      "site",
      "posts",
      "liked",
    ]);
    expect(user!.fields.find((field) => field.name === "posts")).toEqual({
      name: "posts",
      type: "Post",
      list: true,
      optional: false,
      relation: { name: "Written", fields: [], references: [] },
    });
    expect(post!.fields.find((field) => field.name === "fan")).toEqual({
      name: "fan",
      type: "User",
      list: false,
      optional: true,
      relation: { name: "Liked", fields: ["fanId"], references: ["id"] },
    });
    expect(post!.fields.find((field) => field.name === "authorId")!.relation).toBeUndefined();
  });
});

/** A folder with these files, made in a temporary repository. */
function repository(files: Record<string, string>) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "query-profiler-schema-"));
  mkdirSync(join(root, ".git"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

const SHOP = "model Order {\n  id Int @id\n}\n";

describe("finding the app's schema", () => {
  it("takes the path prisma.config.ts gives, from a folder below it", () => {
    const root = repository({
      "prisma.config.ts": `export default defineConfig({ schema: "db/main.prisma" });`,
      "db/main.prisma": BLOG,
      "src/routes/.keep": "",
    });
    expect(findSchema(["Post"], join(root, "src/routes"))?.path).toBe(join(root, "db/main.prisma"));
  });

  it("reads every file of a schema folder", () => {
    const root = repository({
      "prisma/schema/blog.prisma": BLOG,
      "prisma/schema/shop.prisma": SHOP,
    });
    const schema = findSchema(["Order"], root);
    expect(schema?.models.map((model) => model.name)).toEqual(["User", "Post", "Order"]);
  });

  it("finds a monorepo's package schema from the app's folder, the one with the profile's models", () => {
    const root = repository({
      "apps/web/package.json": "{}",
      "packages/database/prisma/schema.prisma": BLOG,
      "packages/shop/prisma/schema.prisma": SHOP,
    });
    const from = join(root, "apps/web");
    expect(findSchema(["Order"], from)?.path).toBe(
      join(root, "packages/shop/prisma/schema.prisma"),
    );
    expect(findSchema(["User", "Post"], from)?.path).toBe(
      join(root, "packages/database/prisma/schema.prisma"),
    );
  });

  it("reads a schema again once it changes", () => {
    const root = repository({ "prisma/schema.prisma": SHOP });
    expect(findSchema([], root)?.models.map((model) => model.name)).toEqual(["Order"]);
    const file = join(root, "prisma/schema.prisma");
    writeFileSync(file, BLOG);
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(findSchema([], root)?.models.map((model) => model.name)).toEqual(["User", "Post"]);
  });

  it("finds none where there is none", () => {
    expect(findSchema(["User"], repository({ "src/index.ts": "" }))).toBeUndefined();
  });
});
