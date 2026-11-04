import type { MiddlewareFunction } from "react-router";

export const TOKEN_HEADER = "X-Debug-Token";
export const profilerMiddleware = (): MiddlewareFunction<Response> => (_args, next) => next();
