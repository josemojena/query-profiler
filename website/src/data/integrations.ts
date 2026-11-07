import {
  siExpress,
  siFastify,
  siHono,
  siKoa,
  siNestjs,
  siMysql,
  siPostgresql,
  siSqlite,
  siMariadb,
  siNodedotjs,
  siPrisma,
  siReactrouter,
  type SimpleIcon,
} from "simple-icons";

export type Status = "ready" | "next" | "planned";

/** Where it sits: the ORM the profiler hooks into, the server it runs in, the database it talks to. */
export type Kind = "orm" | "framework" | "database";

export interface Integration {
  name: string;
  kind: Kind;
  /** The versions it works with, when that matters. */
  versions?: string;
  /** How it is set up, or what else it needs, for the compatibility page. */
  note?: string;
  /** Its logo from Simple Icons; one without a logo shows its initials. */
  logo?: SimpleIcon;
  status: Status;
  /** The docs page that sets it up, once it is ready. */
  guide?: string;
}

const NODE = "docs/guides/node";
const DATABASES = "docs/guides/prisma#databases";

/** What query-profiler works with. The landing page and the compatibility page both read it. */
export const integrations: Integration[] = [
  {
    name: "Prisma ORM",
    kind: "orm",
    versions: "7.1+",
    note: "Its driver adapter and client extension",
    logo: siPrisma,
    status: "ready",
    guide: "docs/guides/prisma",
  },
  {
    name: "React Router",
    kind: "framework",
    versions: "7.9+ · 8",
    note: "Through the Vite plugin, Vite 6+; Remix too",
    logo: siReactrouter,
    status: "ready",
    guide: "docs/guides/react-router",
  },
  {
    name: "Express",
    kind: "framework",
    versions: "4.18+ · 5",
    note: "Through the preload",
    logo: siExpress,
    status: "ready",
    guide: NODE,
  },
  {
    name: "Fastify",
    kind: "framework",
    versions: "4.26+ · 5",
    note: "Through the preload",
    logo: siFastify,
    status: "ready",
    guide: NODE,
  },
  {
    name: "NestJS",
    kind: "framework",
    versions: "12",
    note: "Through the preload, on Express",
    logo: siNestjs,
    status: "ready",
    guide: NODE,
  },
  {
    name: "Koa",
    kind: "framework",
    versions: "3",
    note: "Through the preload",
    logo: siKoa,
    status: "ready",
    guide: NODE,
  },
  {
    name: "Hapi",
    kind: "framework",
    versions: "21",
    note: "Through the preload",
    status: "ready",
    guide: NODE,
  },
  {
    name: "Hono",
    kind: "framework",
    versions: "4 on Node",
    note: "Through the preload, on @hono/node-server",
    logo: siHono,
    status: "ready",
    guide: NODE,
  },
  {
    name: "Any Node server",
    kind: "framework",
    versions: "http · http2",
    note: "Through the preload: any server built on Node's http module; http2 on Node 22.17+ and 24.2+",
    logo: siNodedotjs,
    status: "ready",
    guide: NODE,
  },
  {
    name: "PostgreSQL",
    kind: "database",
    note: "@prisma/adapter-pg; raw SQL through pg too",
    logo: siPostgresql,
    status: "ready",
    guide: DATABASES,
  },
  {
    name: "MySQL",
    kind: "database",
    note: "@prisma/adapter-mariadb",
    logo: siMysql,
    status: "ready",
    guide: DATABASES,
  },
  {
    name: "MariaDB",
    kind: "database",
    note: "@prisma/adapter-mariadb",
    logo: siMariadb,
    status: "ready",
    guide: DATABASES,
  },
  {
    name: "SQLite",
    kind: "database",
    note: "@prisma/adapter-better-sqlite3",
    logo: siSqlite,
    status: "ready",
    guide: DATABASES,
  },
  { name: "Next.js", kind: "framework", status: "planned" },
  { name: "Prisma ORM", kind: "orm", versions: "8", status: "planned" },
];
