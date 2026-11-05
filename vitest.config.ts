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
          // The clients are built when each file loads, as an app in development builds them.
          env: { NODE_ENV: "development" },
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
