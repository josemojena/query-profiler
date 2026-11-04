import {
  beginOperation,
  captureOrigin,
  currentScope,
  enterScope,
  finishOperation,
} from "../core/index.js";

interface OperationParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/** The Prisma client extension: `prisma.$extends(profilerExtension)`. Records each operation and where it came from. */
export const profilerExtension = {
  name: "query-profiler",
  query: {
    async $allOperations({ model, operation, args, query }: OperationParams): Promise<unknown> {
      const scope = currentScope();
      if (!scope) return query(args);
      const op = beginOperation(scope.profile, {
        model,
        action: operation,
        args,
        origin: scope.call ?? captureOrigin(),
      });
      // Prisma runs the query after this function returns, in this same async context:
      // a run() around query() would not reach it.
      enterScope({ opId: op.id, call: undefined });
      try {
        const result = await query(args);
        finishOperation(scope.profile, op);
        return result;
      } catch (error) {
        finishOperation(scope.profile, op, error);
        throw error;
      }
    },
  },
};
