import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { queryProfiler } from "query-profiler/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [queryProfiler({ log: true }), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
