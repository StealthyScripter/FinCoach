import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHttpErrorHandler } from "./httpErrorHandler";

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
