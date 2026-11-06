/** A database family with its own SQL, planner and EXPLAIN. MariaDB speaks MySQL's protocol, not its EXPLAIN. */
export type Engine = "postgres" | "mysql" | "mariadb" | "sqlite";

/**
 * How a step reads a table: every row, every entry of an index, some rows through an index, from the
 * index alone, one row by a unique key, or through an index the database built for this query.
 */
export type Access = "full" | "index-full" | "index" | "index-only" | "unique" | "automatic-index";

export type StepKind = "read" | "join" | "sort" | "group" | "limit" | "write" | "other";

export interface Measured {
  /** Rows it returned, over every loop. */
  rows: number;
  loops: number;
  /** Time spent in it and under it, over every loop. */
  ms?: number;
  /** Rows it read and threw away, over every loop. */
  removedByFilter?: number;
}

export interface PlanStep {
  /** The database's own name for the step: "Seq Scan", "ALL", "SCAN Order". */
  label: string;
  kind: StepKind;
  /** The table as the plan names it: an alias, when the SQL gave one. */
  table?: string;
  /** The table's real name, when the plan gives it. */
  relation?: string;
  access?: Access;
  index?: string;
  /** What the index looks up, in the database's words. */
  lookup?: string;
  /** What is checked on each row read, in the database's words. */
  filter?: string;
  /** Indexes the database considered (MySQL and MariaDB say so). */
  possibleIndexes?: string[];
  /** Estimated rows the step returns. */
  rows?: number;
  /** Estimated rows the step reads to return them. */
  rowsRead?: number;
  cost?: number;
  /** What it sorts or groups by, in the database's words. */
  keys?: string[];
  /** It sorts, groups or removes duplicates through a temporary table or b-tree. */
  temporary?: boolean;
  /** It ran out of memory and wrote to disk. */
  onDisk?: boolean;
  /** Anything else the database says about the step, in its words. */
  notes?: string[];
  measured?: Measured;
  children: PlanStep[];
}

export interface Plan {
  engine: Engine;
  version: string;
  /** The database ran the query to measure it, instead of only estimating. */
  measured: boolean;
  /** Planned without the parameters' values: some were hidden or cut when recorded. */
  generic: boolean;
  /** Planned with stand-ins for parameters that were hidden or cut when recorded. */
  approximate: boolean;
  steps: PlanStep[];
  /** The database's own answer, as text. */
  raw: string;
}

/** Every step, parents before their children. */
export function allSteps(steps: PlanStep[]): PlanStep[] {
  return steps.flatMap((step) => [step, ...allSteps(step.children)]);
}

/** A step with only the fields that have a value, so plans compare and print cleanly. */
export function step(
  fields: Partial<Omit<PlanStep, "children">> & Pick<PlanStep, "label" | "kind">,
  children: PlanStep[] = [],
): PlanStep {
  const defined = Object.entries(fields).filter(
    ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
  );
  return { ...(Object.fromEntries(defined) as typeof fields), children };
}

export const asNumber = (value: unknown): number | undefined => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
};

export const asText = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/** EXPLAIN's JSON, which some drivers parse and others hand over as text. */
export const parseJson = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;
