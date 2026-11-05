import type { IncomingMessage, ServerResponse } from "node:http";

export const profilerMiddleware =
  () => (_req: IncomingMessage, _res: ServerResponse, next: (error?: unknown) => void) =>
    next();
