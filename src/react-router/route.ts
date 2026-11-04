import { createHandler } from "../core/index.js";

const handle = createHandler();

/** Mount at `/_profiler/*` (a splat resource route) in development. */
export const loader = ({ request }: { request: Request }) => handle(request);
export const action = ({ request }: { request: Request }) => handle(request);
