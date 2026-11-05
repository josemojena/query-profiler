import {
  siExpress,
  siFastify,
  siPostgresql,
  siPrisma,
  siReactrouter,
  siVite,
  type SimpleIcon,
} from "simple-icons";

export type Status = "ready" | "next" | "planned";

export interface Integration {
  name: string;
  /** The versions it works with, when that matters. */
  versions?: string;
  /** Its logo from Simple Icons; one without a logo shows its initials. */
  logo?: SimpleIcon;
  status: Status;
  /** The docs page that sets it up, once it is ready. */
  guide?: string;
}

/** What query-profiler works with. The landing page and the compatibility page both read it. */
export const integrations: Integration[] = [
  {
    name: "Prisma ORM",
    versions: "7.1+",
    logo: siPrisma,
    status: "ready",
    guide: "docs/guides/prisma",
  },
  { name: "PostgreSQL", logo: siPostgresql, status: "ready", guide: "docs/installation" },
  {
    name: "React Router",
    versions: "7.9+ · 8 · Remix",
    logo: siReactrouter,
    status: "ready",
    guide: "docs/guides/react-router",
  },
  {
    name: "Vite",
    versions: "6+",
    logo: siVite,
    status: "ready",
    guide: "docs/guides/react-router",
  },
  {
    name: "Fastify",
    versions: "4.26+ · 5",
    logo: siFastify,
    status: "ready",
    guide: "docs/guides/fastify",
  },
  {
    name: "Express",
    versions: "4.18+ · 5",
    logo: siExpress,
    status: "ready",
    guide: "docs/guides/express",
  },
  { name: "Next.js · NestJS", status: "planned" },
  { name: "MySQL", status: "planned" },
  { name: "Prisma ORM", versions: "8", status: "planned" },
];

/** The name with its versions, as one line of text. */
export const fullName = (integration: Integration) =>
  integration.versions ? `${integration.name} ${integration.versions}` : integration.name;
