import {
  createHandler,
  DEFAULT_BASE,
  enabled,
  endProfile,
  PARENT_HEADER,
  runWithProfile,
  startProfile,
  TOKEN_HEADER,
  type ActiveProfile,
  type Profile,
} from "../core/index.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";

const EXPOSE_HEADERS = "Access-Control-Expose-Headers";

export interface ProfilerPluginOptions {
  /** Where the profiler's pages and API live; requests to them are not profiled. */
  base?: string;
  /** Called with each profile once its response has been sent. */
  onProfile?: (profile: Profile) => void;
}

/** Opens a profile for each request and serves the profiler under `base`; does nothing outside development. */
export const profilerPlugin = fastifyPlugin(
  async (app: FastifyInstance, options: ProfilerPluginOptions) => {
    if (!enabled()) return;
    const base = options.base ?? DEFAULT_BASE;
    const profiles = new WeakMap<FastifyRequest, ActiveProfile>();
    const end = (request: FastifyRequest, status?: number) => {
      const active = profiles.get(request);
      if (!active || active.closed) return;
      const profile = endProfile(active, status === undefined ? undefined : { status });
      options.onProfile?.(profile);
    };

    const handle = createHandler({ base });
    app.route({
      method: ["GET", "DELETE"],
      url: `${base}/*`,
      handler: async (request, reply) => reply.send(await handle(toRequest(request))),
    });
    app.get(base, async (request, reply) => reply.send(await handle(toRequest(request))));

    app.addHook("onRequest", (request, _reply, done) => {
      if (request.url.startsWith(base)) return done();
      const active = startProfile(
        {
          method: request.method,
          url: request.url,
          kind: "api",
          route: request.routeOptions.url,
          parentToken: parentOf(request),
        },
        { name: "fastify", version: app.version },
      );
      profiles.set(request, active);
      runWithProfile(active, done);
    });
    app.addHook("onSend", (request, reply, _payload, done) => {
      const active = profiles.get(request);
      if (active) {
        reply.header(TOKEN_HEADER, active.profile.token);
        if (request.headers.origin) exposeToken(reply);
      }
      done();
    });
    app.addHook("onResponse", (request, reply, done) => {
      end(request, reply.statusCode);
      done();
    });
    app.addHook("onRequestAbort", (request, done) => {
      end(request);
      done();
    });
  },
  { name: "query-profiler", fastify: ">=4.26.0" },
);

function parentOf(request: FastifyRequest): string | undefined {
  const token = request.headers[PARENT_HEADER.toLowerCase()];
  return typeof token === "string" && /^[0-9a-f]{6}$/.test(token) ? token : undefined;
}

// A page on another origin can only read the token if CORS exposes it.
function exposeToken(reply: FastifyReply) {
  const current = reply.getHeader(EXPOSE_HEADERS);
  const exposed = [current].flat().filter(Boolean).join(", ");
  if (!exposed.toLowerCase().includes(TOKEN_HEADER.toLowerCase()))
    reply.header(EXPOSE_HEADERS, exposed ? `${exposed}, ${TOKEN_HEADER}` : TOKEN_HEADER);
}

function toRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers))
    if (value !== undefined) headers.set(key, [value].flat().join(", "));
  return new Request(`${request.protocol}://${request.headers.host ?? "localhost"}${request.url}`, {
    method: request.method,
    headers,
  });
}
