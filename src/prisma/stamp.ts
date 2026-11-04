import { isTransactionControl, type ActiveProfile } from "../core/index.js";

const KEY = "query_profiler";

interface CommenterContext {
  query: { type: "single" | "compacted"; modelName?: string; action: string };
}

/** A sqlcommenter plugin that names the Prisma operation each statement answers. */
export function stampPlugin({ query }: CommenterContext): Record<string, string> {
  return {
    [KEY]: `${query.type === "compacted" ? "*" : ""}${query.modelName ?? ""}.${query.action}`,
  };
}

export interface Stamp {
  model?: string;
  action: string;
  compacted: boolean;
}

/** The statement without our stamp, and what the stamp said. */
export function readStamp(sql: string): { sql: string; stamp?: Stamp } {
  let stamp: Stamp | undefined;
  const clean = sql.replace(/\s*\/\*((?:[^*]|\*(?!\/))*)\*\//g, (comment, body: string) => {
    const pairs = body.split(",").map((pair) => pair.trim());
    const ours = pairs.find((pair) => pair.startsWith(`${KEY}=`));
    if (!ours) return comment;
    stamp = parseStamp(decodeURIComponent(ours.slice(KEY.length + 1).replace(/^'|'$/g, "")));
    const rest = pairs.filter((pair) => pair !== ours);
    return rest.length ? ` /*${rest.join(",")}*/` : "";
  });
  return { sql: clean.trim(), stamp };
}

function parseStamp(value: string): Stamp {
  const compacted = value.startsWith("*");
  const [model, action] = (compacted ? value.slice(1) : value).split(".") as [string, string];
  return { model: model || undefined, action, compacted };
}

// The query engine names some actions differently from the client API.
const ENGINE_ACTIONS: Record<string, string[]> = {
  createOne: ["create"],
  updateOne: ["update"],
  deleteOne: ["delete"],
  upsertOne: ["upsert"],
  aggregate: ["aggregate", "count"],
  findUnique: ["findUnique", "findUniqueOrThrow"],
  findFirst: ["findFirst", "findFirstOrThrow"],
  queryRaw: ["$queryRaw", "$queryRawUnsafe"],
  executeRaw: ["$executeRaw", "$executeRawUnsafe"],
};

/**
 * The operations a statement answers. The async context names a likely one, but Prisma
 * runs a batch transaction in the context of its first operation; the stamp settles it.
 */
export function linkOperations(
  active: ActiveProfile,
  sql: string,
  stamp: Stamp | undefined,
  scopedOpId: string | undefined,
): string[] {
  if (!stamp) return scopedOpId && !isTransactionControl(sql) ? [scopedOpId] : [];
  const open = active.profile.operations.filter(
    (op) =>
      op.durationMs === undefined &&
      op.model === stamp.model &&
      (op.action === stamp.action || ENGINE_ACTIONS[stamp.action]?.includes(op.action)),
  );
  if (stamp.compacted) return open.map((op) => op.id);
  const op = open.find((candidate) => candidate.id === scopedOpId) ?? open[0];
  return op ? [op.id] : [];
}
