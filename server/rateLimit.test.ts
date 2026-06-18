import assert from "node:assert/strict";
import { createApiRateLimiter } from "./rateLimit";

let currentTime = 0;
const middleware = createApiRateLimiter({
  windowMs: 1_000,
  maxRequests: 2,
  now: () => currentTime,
});

function runRequest() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown = null;
  let nextCalled = false;

  middleware(
    {
      ip: "127.0.0.1",
      socket: {},
    } as any,
    {
      setHeader: (key: string, value: string) => headers.set(key, value),
      status: (status: number) => {
        statusCode = status;
        return {
          json: (payload: unknown) => {
            body = payload;
          },
        };
      },
    } as any,
    () => {
      nextCalled = true;
    },
  );

  return { headers, statusCode, body, nextCalled };
}

assert.equal(runRequest().nextCalled, true);
assert.equal(runRequest().nextCalled, true);

const limited = runRequest();
assert.equal(limited.nextCalled, false);
assert.equal(limited.statusCode, 429);
assert.equal(limited.headers.get("RateLimit-Remaining"), "0");
assert.deepEqual(limited.body, {
  message: "Too many API requests. Please wait before retrying.",
  retryAfterSeconds: 1,
});

currentTime = 1_001;
const reset = runRequest();
assert.equal(reset.nextCalled, true);
assert.equal(reset.headers.get("RateLimit-Remaining"), "1");

console.log("rateLimit smoke tests passed");
