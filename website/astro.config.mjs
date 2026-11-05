// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [
    starlight({
      title: "query-profiler",
      description:
        "The database profiler for Prisma ORM, in development: every query of a request, the line of code behind it, N+1, slow and duplicate warnings.",
      logo: { src: "./src/assets/logo.svg" },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/josemojena/query-profiler" },
      ],
      editLink: { baseUrl: "https://github.com/josemojena/query-profiler/edit/main/website/" },
      customCss: [
        "@fontsource/ibm-plex-sans/400.css",
        "@fontsource/ibm-plex-sans/600.css",
        "@fontsource/martian-mono/700.css",
        "@fontsource/jetbrains-mono/400.css",
        "./src/styles/docs.css",
      ],
      sidebar: [
        { label: "Start here", items: ["docs", "docs/installation"] },
        {
          label: "Guides",
          items: ["docs/guides/react-router", "docs/guides/prisma", "docs/guides/turning-it-off"],
        },
        {
          label: "Concepts",
          items: [
            "docs/concepts/how-it-works",
            "docs/concepts/the-bar",
            "docs/concepts/profiler-page",
            "docs/concepts/warnings",
            "docs/concepts/security",
          ],
        },
        {
          label: "Reference",
          items: [
            "docs/reference/entry-points",
            "docs/reference/http-api",
            "docs/reference/compatibility",
            "docs/changelog",
          ],
        },
      ],
    }),
  ],
});
