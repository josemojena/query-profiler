import { createHandler } from "../core/index.js";

const handle = createHandler();

/** The profiler's page and API. In `app/%5Fprofiler/[[...path]]/route.ts`: `export { GET, DELETE } from "query-profiler/next/route";` */
export const GET = (request: Request) => handle(request);
export const DELETE = GET;
