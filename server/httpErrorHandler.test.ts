import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHttpErrorHandler, installExpressAsyncErrorPropagation } from "./httpErrorHandler";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

{
  const app = express();
  app.get("/fails-before-headers", (_req, _res, next) => {
    const error = new Error("planned failure") as Error & { status: number };
    error.status = 418;
    next(error);
  });
  app.use(createHttpErrorHandler());

  const server = createServer(app);
  await listen(server);
  try {
    const response = await fetch(url(server, "/fails-before-headers"));
    assert.equal(response.status, 418);
    assert.deepEqual(await response.json(), { message: "planned failure" });
  } finally {
    await close(server);
  }
}

{
  const app = express();
  installExpressAsyncErrorPropagation(app);
  app.get("/async-rejection", async () => {
    throw Object.assign(new Error("async failure"), { status: 503 });
  });
  app.use(createHttpErrorHandler());

  const server = createServer(app);
  await listen(server);
  try {
    const response = await fetch(url(server, "/async-rejection"));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: "async failure" });
  } finally {
    await close(server);
  }
}

{
  const app = express();
  installExpressAsyncErrorPropagation(app);
  let delegated = false;
  app.get("/async-sends-then-rejects", async (_req, res) => {
    res.json({ ok: true });
    throw new Error("async reported after send");
  });
  app.use(createHttpErrorHandler());
  app.use((err: Error, _req: express.Request, _res: express.Response, _next: express.NextFunction) => {
    delegated = true;
    assert.equal(err.message, "async reported after send");
  });

  const server = createServer(app);
  await listen(server);
  try {
    const response = await fetch(url(server, "/async-sends-then-rejects"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    await waitFor(() => delegated);
  } finally {
    await close(server);
  }
}

{
  const app = express();
  let delegated = false;
  app.get("/fails-after-headers", (_req, res, next) => {
    res.write("partial response");
    next(new Error("late failure"));
  });
  app.use(createHttpErrorHandler());
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    delegated = true;
    assert.equal(err.message, "late failure");
    res.end();
  });

  const server = createServer(app);
  await listen(server);
  try {
    const response = await fetch(url(server, "/fails-after-headers"));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "partial response");
    assert.equal(delegated, true);
  } finally {
    await close(server);
  }
}

{
  const app = express();
  let delegated = false;
  app.get("/sends-then-errors", (_req, res, next) => {
    res.json({ ok: true });
    next(new Error("reported after send"));
  });
  app.use(createHttpErrorHandler());
  app.use((err: Error, _req: express.Request, _res: express.Response, _next: express.NextFunction) => {
    delegated = true;
    assert.equal(err.message, "reported after send");
  });

  const server = createServer(app);
  await listen(server);
  try {
    const response = await fetch(url(server, "/sends-then-errors"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    await waitFor(() => delegated);
  } finally {
    await close(server);
  }
}

{
  const app = express();
  let delegated = false;
  app.use((_req, res, next) => {
    res.write("chunk");
    next(new Error("middleware late failure"));
  });
  app.use(createHttpErrorHandler());
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    delegated = true;
    assert.equal(err.message, "middleware late failure");
    res.end();
  });

  const server = createServer(app);
  await listen(server);
  try {
    const response = await fetch(url(server, "/middleware-late"));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "chunk");
    assert.equal(delegated, true);
  } finally {
    await close(server);
  }
}

console.log("http error handler tests passed");

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function url(server: ReturnType<typeof createServer>, path: string) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}${path}`;
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("condition not reached");
}
