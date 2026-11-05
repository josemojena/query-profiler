export type Status = "ready" | "next" | "planned";

export interface Integration {
  name: string;
  status: Status;
  /** The docs page that sets it up, once it is ready. */
  guide?: string;
}

/** What query-profiler works with. The landing page and the compatibility page both read it. */
export const integrations: Integration[] = [
  { name: "Prisma ORM 7.1+", status: "ready", guide: "docs/guides/prisma" },
  { name: "PostgreSQL", status: "ready", guide: "docs/installation" },
  { name: "React Router 7.9+ · 8 · Remix", status: "ready", guide: "docs/guides/react-router" },
  { name: "Vite 6+", status: "ready", guide: "docs/guides/react-router" },
  { name: "Fastify 4.26+ · 5", status: "ready", guide: "docs/guides/fastify" },
  { name: "Next.js · NestJS", status: "planned" },
  { name: "MySQL", status: "planned" },
  { name: "Prisma ORM 8", status: "planned" },
];
