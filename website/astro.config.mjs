// @ts-check
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { OG_IMAGE, OG_IMAGE_ALT } from "./src/data/site.ts";

const SITE = "https://query-profiler.dev";
const ogImage = `${SITE}/${OG_IMAGE}`;

export default defineConfig({
  site: SITE,
  trailingSlash: "never",
  // The Express and Fastify guides moved under Node servers.
  redirects: {
    "/docs/guides/express": "/docs/guides/node/express",
    "/docs/guides/fastify": "/docs/guides/node/fastify",
  },
  build: { format: "file" },
  integrations: [
    // The demo pages are noindex: keep them out of the sitemap too.
    sitemap({ filter: (page) => !page.includes("/demo-profiler") }),
    starlight({
      title: "query-profiler",
      description:
        "The database profiler for Prisma ORM, in development: every query of a request, the line of code behind it, N+1, slow and duplicate warnings.",
      logo: { src: "./src/assets/logo.svg" },
      head: [
        { tag: "meta", attrs: { property: "og:image", content: ogImage } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1280" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "640" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: OG_IMAGE_ALT } },
        { tag: "meta", attrs: { name: "twitter:image", content: ogImage } },
      ],
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
          items: [
            "docs/guides/react-router",
            {
              label: "Node servers",
              items: [
                { slug: "docs/guides/node", label: "Setup" },
                "docs/guides/node/express",
                "docs/guides/node/fastify",
                "docs/guides/node/nestjs",
                "docs/guides/node/koa",
                "docs/guides/node/hapi",
                "docs/guides/node/hono",
              ],
            },
            "docs/guides/scripts",
            "docs/guides/mcp",
            "docs/guides/prisma",
            "docs/guides/turning-it-off",
            "docs/guides/troubleshooting",
          ],
        },
        {
          label: "Concepts",
          items: [
            "docs/concepts/how-it-works",
            "docs/concepts/the-bar",
            "docs/concepts/profiler-page",
            "docs/concepts/warnings",
            "docs/concepts/query-analysis",
            "docs/concepts/security",
          ],
        },
        {
          label: "Reference",
          items: [
            "docs/reference/entry-points",
            "docs/reference/http-api",
            "docs/reference/rules",
            "docs/reference/compatibility",
            "docs/changelog",
          ],
        },
      ],
    }),
  ],
});
