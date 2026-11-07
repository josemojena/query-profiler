import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CONFIG_FILES = ["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `prisma.config.${ext}`);
const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "build", "coverage"]);
const SEARCH_DEPTH = 3;

/** A field of a model in `schema.prisma`. */
export interface SchemaField {
  name: string;
  /** A scalar type (Int, String…), an enum, or another model's name. */
  type: string;
  list: boolean;
  optional: boolean;
  /** The column it is stored in, from @map, when it has another name. */
  column?: string;
  /** On a relation field: its @relation name, and on the side that holds the key, its fields. */
  relation?: { name?: string; fields: string[]; references: string[] };
}

export interface SchemaModel {
  name: string;
  /** The table it is stored in, from @@map, when it has another name. */
  table?: string;
  fields: SchemaField[];
}

export interface Schema {
  /** The file, or the folder of files, it was read from. */
  path: string;
  /** When its files last changed, as milliseconds since the epoch. */
  changed?: number;
  models: SchemaModel[];
}

/** How the database's names read in the schema: a table's model, a column's field. */
export interface PrismaNames {
  model(table: string): string;
  field(table: string, column: string): string;
}

/** The database's own names, for when there is no schema to read. */
export const DATABASE_NAMES: PrismaNames = {
  model: (table) => table,
  field: (_, column) => column,
};

/** The names a schema gives the database's tables and columns, through @@map and @map. */
export function prismaNames(schema: Schema | undefined): PrismaNames {
  if (!schema) return DATABASE_NAMES;
  // MySQL and SQLite compare names in any case, and may report them in another.
  const find = <T>(items: T[], name: (item: T) => string, wanted: string) =>
    items.find((item) => name(item) === wanted) ??
    items.find((item) => name(item).toLowerCase() === wanted.toLowerCase());
  const modelOf = (table: string) =>
    find(schema.models, (model) => model.table ?? model.name, table);
  return {
    model: (table) => modelOf(table)?.name ?? table,
    field: (table, column) => {
      const scalars = modelOf(table)?.fields.filter((field) => !field.relation) ?? [];
      return find(scalars, (field) => field.column ?? field.name, column)?.name ?? column;
    },
  };
}

/** The models of a Prisma schema, with their fields and relations. */
export function readSchema(text: string, path = ""): Schema {
  const models: SchemaModel[] = [];
  let current: SchemaModel | undefined;
  for (const raw of text.split("\n")) {
    const line = withoutComment(raw).trim();
    const opened = /^model\s+(\w+)\s*\{/.exec(line);
    if (opened) {
      current = { name: opened[1]!, fields: [] };
      models.push(current);
      continue;
    }
    if (line.startsWith("}")) current = undefined;
    const table = /^@@map\(\s*"([^"]+)"/.exec(line)?.[1];
    if (current && table) current.table = table;
    if (!current || !line || line.startsWith("@@")) continue;
    const field = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
    if (field)
      current.fields.push({
        name: field[1]!,
        type: field[2]!,
        list: field[3] !== undefined,
        optional: field[4] !== undefined,
        ...columnOf(field[5]!),
        ...relationOf(field[5]!),
      });
  }
  const names = new Set(models.map((model) => model.name));
  for (const model of models)
    for (const field of model.fields)
      if (names.has(field.type)) field.relation ??= { fields: [], references: [] };
      else delete field.relation;
  return { path, models };
}

function columnOf(attributes: string): Pick<SchemaField, "column"> {
  const column = /@map\(\s*"([^"]+)"/.exec(attributes)?.[1];
  return column ? { column } : {};
}

function relationOf(attributes: string): Pick<SchemaField, "relation"> {
  const relation = /@relation\(([^)]*)\)/.exec(attributes)?.[1];
  if (relation === undefined) return {};
  const list = (key: string) =>
    (new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(relation)?.[1] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const name = /^\s*"([^"]*)"/.exec(relation)?.[1] ?? /name\s*:\s*"([^"]*)"/.exec(relation)?.[1];
  return {
    relation: { ...(name ? { name } : {}), fields: list("fields"), references: list("references") },
  };
}

// A // inside a string ("https://…" in a default) is not a comment.
function withoutComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index - 1] !== "\\") quoted = !quoted;
    else if (!quoted && line.startsWith("//", index)) return line.slice(0, index);
  }
  return line;
}

const read = new Map<string, { changed: number; schema: Schema }>();

/**
 * The app's schema, for the `models` a profile uses: where `prisma.config.ts` says, or in
 * `prisma/schema.prisma` or `prisma/schema/`, from `from` up to the repository root, then in the
 * repository's folders (a monorepo's package). Among several, the one that has those models.
 */
export function findSchema(models: string[], from = process.cwd()): Schema | undefined {
  const root = repositoryRoot(from);
  const near = [...upwards(from, root)].flatMap(candidatesIn);
  const found = [...near, ...(near.length ? [] : searchBelow(root))];
  const schemas = [...new Set(found)].flatMap((path) => load(path) ?? []);
  const fits = (schema: Schema) =>
    models.filter((model) => schema.models.some((each) => each.name === model)).length;
  const best = Math.max(0, ...schemas.map(fits));
  return best ? schemas.find((schema) => fits(schema) === best) : schemas[0];
}

/** A schema file, or every .prisma file of a folder, read again only once it changed. */
function load(path: string): Schema | undefined {
  try {
    const files = statSync(path).isDirectory()
      ? readdirSync(path, { recursive: true, encoding: "utf8" })
          .filter((name) => name.endsWith(".prisma"))
          .map((name) => join(path, name))
      : [path];
    const changed = Math.max(...files.map((file) => statSync(file).mtimeMs));
    const known = read.get(path);
    if (known?.changed === changed) return known.schema;
    const schema = {
      ...readSchema(files.map((file) => readFileSync(file, "utf8")).join("\n"), path),
      changed,
    };
    read.set(path, { changed, schema });
    return schema.models.length ? schema : undefined;
  } catch {
    return undefined;
  }
}

/** Where a folder keeps its schema: what its Prisma config names, or the usual places. */
function candidatesIn(dir: string): string[] {
  const configured = CONFIG_FILES.map((name) => join(dir, name))
    .filter((file) => existsSync(file))
    .flatMap((file) => {
      const named = /\bschema\s*:\s*(["'`])([^"'`]+)\1/.exec(readFileSync(file, "utf8"))?.[2];
      return named ? [resolve(dir, named)] : [];
    });
  const usual = [
    join(dir, "prisma", "schema.prisma"),
    join(dir, "prisma", "schema"),
    join(dir, "schema.prisma"),
  ];
  return [...configured, ...usual].filter((path) => existsSync(path));
}

function* upwards(from: string, root: string): Generator<string> {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    yield dir;
    if (dir === root || dir === dirname(dir)) return;
  }
}

function searchBelow(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > SEARCH_DEPTH) return;
    found.push(...candidatesIn(dir));
    let entries: string[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return;
    }
    for (const name of entries)
      if (!name.startsWith(".") && !SKIPPED_FOLDERS.has(name)) visit(join(dir, name), depth + 1);
  };
  visit(root, 0);
  return found;
}

function repositoryRoot(from: string): string {
  for (const dir of upwards(from, "/")) if (existsSync(join(dir, ".git"))) return dir;
  return resolve(from);
}
