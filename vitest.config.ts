import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "test/prisma/**"],
        },
      },
      {
        test: {
          name: "prisma",
          include: ["test/prisma/**/*.test.ts"],
          globalSetup: ["test/prisma/global-setup.ts"],
          pool: "forks",
          maxWorkers: 1,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
