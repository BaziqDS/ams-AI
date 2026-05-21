import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelRetryMiddlewareConfig,
  shouldRetryModelError,
} from "./resilience.js";

test("model retry config uses production defaults", () => {
  const config = buildModelRetryMiddlewareConfig({});

  assert.equal(config.maxRetries, 3);
  assert.equal(config.initialDelayMs, 1000);
  assert.equal(config.maxDelayMs, 30000);
  assert.equal(config.backoffFactor, 2);
  assert.equal(config.jitter, true);
  assert.equal(config.onFailure, "continue");
  assert.equal(typeof config.retryOn, "function");
});

test("model retry config supports safe environment overrides", () => {
  const config = buildModelRetryMiddlewareConfig({
    AGENT_MODEL_RETRY_MAX_RETRIES: "5",
    AGENT_MODEL_RETRY_INITIAL_DELAY_MS: "250",
    AGENT_MODEL_RETRY_MAX_DELAY_MS: "10000",
    AGENT_MODEL_RETRY_BACKOFF_FACTOR: "1.5",
    AGENT_MODEL_RETRY_JITTER: "false",
    AGENT_MODEL_RETRY_ON_FAILURE: "error",
  });

  assert.equal(config.maxRetries, 5);
  assert.equal(config.initialDelayMs, 250);
  assert.equal(config.maxDelayMs, 10000);
  assert.equal(config.backoffFactor, 1.5);
  assert.equal(config.jitter, false);
  assert.equal(config.onFailure, "error");
});

test("model retry predicate retries transient provider and transport failures", () => {
  assert.equal(shouldRetryModelError(new TypeError("terminated")), true);

  const rateLimit = new Error("rate limited");
  (rateLimit as Error & { status?: number }).status = 429;
  assert.equal(shouldRetryModelError(rateLimit), true);

  const serverError = new Error("provider unavailable");
  (serverError as Error & { response?: { status: number } }).response = {
    status: 503,
  };
  assert.equal(shouldRetryModelError(serverError), true);
});

test("model retry predicate does not retry aborts or non-transient client errors", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(shouldRetryModelError(abort), false);

  const badRequest = new Error("invalid request");
  (badRequest as Error & { status?: number }).status = 400;
  assert.equal(shouldRetryModelError(badRequest), false);

  const forbidden = new Error("forbidden");
  (forbidden as Error & { statusCode?: number }).statusCode = 403;
  assert.equal(shouldRetryModelError(forbidden), false);
});
