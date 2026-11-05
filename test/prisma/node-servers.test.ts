import "reflect-metadata";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { bodyParser } from "@koa/bodyparser";
import Router from "@koa/router";
import { Controller, Get, Module, Post, Req } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { serve } from "@hono/node-server";
import Hapi from "@hapi/hapi";
import express from "express";
import Fastify from "fastify";
import { PrismaPg } from "@prisma/adapter-pg";
import { Hono } from "hono";
import Koa from "koa";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfiles, listProfiles, type Profile } from "../../src/core/index.js";
import { profileRequests } from "../../src/node/requests.js";
import { profilePool, profilePrisma, withProfiler } from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";
import { PrismaClient } from "./fixture/generated/client.js";

const pool = profilePool(new pg.Pool({ connectionString: TEST_DATABASE_URL }));
const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter: new PrismaPg(pool) })));

const source = readFileSync(import.meta.filename, "utf8").split("\n");
const lineOf = (snippet: string) => source.findIndex((line) => line.includes(snippet)) + 1;

// What every app below does, so each framework is held to the same profile.
async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } }); // users-call
  return Promise.all(
    users.map(async (user) => ({
      ...user,
      orders: await prisma.order.count({ where: { userId: user.id } }), // count-call
    })),
  );
}
const createUser = (email: string) => prisma.user.create({ data: { email } }); // create-call

interface Running {
  origin: string;
  close: () => Promise<unknown>;
}

const address = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const listening = (server: Server) =>
  new Promise<Running>((resolve) =>
    server.once("listening", () =>
      resolve({
        origin: address(server),
        close: () => new Promise((done) => server.close(done)),
      }),
    ),
  );

async function expressApp(): Promise<Running> {
  const app = express();
  app.use(express.json());
  app.get("/users", async (_request, response) => void response.json(await listUsers()));
  app.post(
    "/users",
    async (request, response) =>
      void response.json(await createUser((request.body as { email: string }).email)),
  );
  return listening(app.listen(0, "127.0.0.1"));
}

async function fastify(): Promise<Running> {
  const app = Fastify();
  app.get("/users", () => listUsers());
  app.post("/users", (request) => createUser((request.body as { email: string }).email));
  await app.listen({ port: 0, host: "127.0.0.1" });
  return { origin: address(app.server), close: () => app.close() };
}

async function koa(): Promise<Running> {
  const app = new Koa();
  const router = new Router();
  router.get("/users", async (ctx) => {
    ctx.body = await listUsers();
  });
  router.post("/users", async (ctx) => {
    ctx.body = await createUser((ctx.request.body as { email: string }).email);
  });
  app.use(bodyParser()).use(router.routes());
  return listening(app.listen(0, "127.0.0.1"));
}

async function hapi(): Promise<Running> {
  const server = Hapi.server({ port: 0, host: "127.0.0.1" });
  server.route({ method: "GET", path: "/users", handler: () => listUsers() });
  server.route({
    method: "POST",
    path: "/users",
    handler: (request) => createUser((request.payload as { email: string }).email),
  });
  await server.start();
  return { origin: server.info.uri, close: () => server.stop() };
}

// Nest's decorators, applied by hand: the test runner compiles standard decorators, Nest's are legacy.
async function nest(): Promise<Running> {
  class Users {
    list() {
      return listUsers();
    }
    create(request: { body: { email: string } }) {
      return createUser(request.body.email);
    }
  }
  const method = (name: "list" | "create") =>
    [Users.prototype, name, Object.getOwnPropertyDescriptor(Users.prototype, name)!] as const;
  Get()(...method("list"));
  Post()(...method("create"));
  Req()(Users.prototype, "create", 0);
  Controller("users")(Users);
  class App {}
  Module({ controllers: [Users] })(App);
  const app = await NestFactory.create(App, { logger: false });
  await app.listen(0, "127.0.0.1");
  return { origin: address(app.getHttpServer() as Server), close: () => app.close() };
}

async function hono(): Promise<Running> {
  const app = new Hono();
  app.get("/users", async (c) => c.json(await listUsers()));
  app.post("/users", async (c) =>
    c.json(await createUser((await c.req.json<{ email: string }>()).email)),
  );
  return listening(serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as Server);
}

/** The profile a response's token names, once the response has closed. */
const profileOf = (response: Response) =>
  vi.waitFor(() => {
    const token = response.headers.get("X-Debug-Token");
    const profile = listProfiles().find((candidate) => candidate.token === token);
    expect(profile?.response).toBeDefined();
    return profile!;
  });

const lines = (profile: Profile) => [
  ...new Set(profile.operations.map((op) => `${op.model}.${op.action}:${op.origin?.[0]?.line}`)),
];

let stop = () => {};
beforeAll(() => {
  stop = profileRequests();
});
afterAll(async () => {
  stop();
  await prisma.$disconnect();
  await pool.end();
});

describe.each([
  ["Express", expressApp],
  ["Fastify", fastify],
  ["Koa", koa],
  ["Hapi", hapi],
  ["NestJS", nest],
  ["Hono on Node", hono],
] as const)("%s, profiled from Node's request channel with no code in the app", (_name, start) => {
  let app: Running;
  beforeAll(async () => {
    app = await start();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    clearProfiles();
    await pool.query('TRUNCATE "Order", "User" RESTART IDENTITY CASCADE');
    for (const n of [1, 2, 3]) await prisma.user.create({ data: { email: `u${n}@example.test` } });
  });

  it("records each query of a request in its profile, with the line that sent it, and the N+1", async () => {
    const profile = await profileOf(await fetch(`${app.origin}/users`));
    expect(profile.summary.queryCount).toBe(4);
    expect(lines(profile)).toEqual([
      `User.findMany:${lineOf("// users-call")}`,
      `Order.count:${lineOf("// count-call")}`,
    ]);
  });

  // Just under Express's 100 KB limit, so the body still arrives in several reads from the socket.
  it("keeps the request's context while the framework reads a large JSON body", async () => {
    const response = await fetch(`${app.origin}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.test", note: "x".repeat(90_000) }),
    });
    expect(lines(await profileOf(response))).toEqual([`User.create:${lineOf("// create-call")}`]);
  });

  it("keeps requests made at the same time apart", async () => {
    const responses = await Promise.all([1, 2, 3, 4].map(() => fetch(`${app.origin}/users`)));
    const profiles = await Promise.all(responses.map(profileOf));
    expect(profiles.map((profile) => profile.summary.queryCount)).toEqual([4, 4, 4, 4]);
    expect(new Set(profiles.map((profile) => profile.token)).size).toBe(4);
  });
});
