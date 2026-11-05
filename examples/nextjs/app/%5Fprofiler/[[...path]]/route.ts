import { createHandler } from "query-profiler";

const handle = createHandler();

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handle(request);
export const DELETE = GET;
