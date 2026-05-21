import type { ModelRetryMiddlewareConfig } from "langchain";

type EnvLike = Record<string, string | undefined>;

const RETRYABLE_CLIENT_STATUSES = new Set([408, 409, 425, 429]);

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parseNonNegativeInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseFailureBehavior(
  value: string | undefined,
): ModelRetryMiddlewareConfig["onFailure"] {
  return value?.trim().toLowerCase() === "error" ? "error" : "continue";
}

function readNumericProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function getErrorStatus(error: unknown): number | undefined {
  const directStatus =
    readNumericProperty(error, "status") ??
    readNumericProperty(error, "statusCode");
  if (directStatus !== undefined) return directStatus;

  if (!error || typeof error !== "object") return undefined;
  const response = (error as Record<string, unknown>).response;
  return (
    readNumericProperty(response, "status") ??
    readNumericProperty(response, "statusCode")
  );
}

export function shouldRetryModelError(error: Error): boolean {
  if (error.name === "AbortError") return false;
  if (/abort/i.test(error.message)) return false;

  const status = getErrorStatus(error);
  if (status === undefined) return true;
  if (status >= 500) return true;
  return RETRYABLE_CLIENT_STATUSES.has(status);
}

export function buildModelRetryMiddlewareConfig(
  env: EnvLike = process.env,
): ModelRetryMiddlewareConfig {
  return {
    maxRetries: parseNonNegativeInt(env.AGENT_MODEL_RETRY_MAX_RETRIES, 3),
    initialDelayMs: parseNonNegativeInt(
      env.AGENT_MODEL_RETRY_INITIAL_DELAY_MS,
      1000,
    ),
    maxDelayMs: parseNonNegativeInt(env.AGENT_MODEL_RETRY_MAX_DELAY_MS, 30000),
    backoffFactor: parseNonNegativeNumber(
      env.AGENT_MODEL_RETRY_BACKOFF_FACTOR,
      2,
    ),
    jitter: parseBoolean(env.AGENT_MODEL_RETRY_JITTER, true),
    onFailure: parseFailureBehavior(env.AGENT_MODEL_RETRY_ON_FAILURE),
    retryOn: shouldRetryModelError,
  };
}
