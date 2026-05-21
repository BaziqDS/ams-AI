import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenRouterChatModelConfig,
  buildOpenRouterReasoningConfig,
} from "./model-config.js";

test("OpenRouter reasoning config is opt-in", () => {
  assert.equal(buildOpenRouterReasoningConfig({}), undefined);
  assert.equal(
    buildOpenRouterReasoningConfig({ OPENROUTER_REASONING_ENABLED: "false" }),
    undefined,
  );
});

test("OpenRouter reasoning config supports effort, max tokens, and exclude", () => {
  assert.deepEqual(
    buildOpenRouterReasoningConfig({
      OPENROUTER_REASONING_ENABLED: "true",
      OPENROUTER_REASONING_EFFORT: "medium",
      OPENROUTER_REASONING_MAX_TOKENS: "2048",
      OPENROUTER_REASONING_EXCLUDE: "true",
    }),
    {
      enabled: true,
      effort: "medium",
      max_tokens: 2048,
      exclude: true,
    },
  );
});

test("OpenRouter model config passes reasoning through modelKwargs", () => {
  const config = buildOpenRouterChatModelConfig({
    OPENROUTER_API_KEY: "key",
    OPENROUTER_MODEL: "qwen/qwen3-235b-a22b-thinking-2507",
    OPENROUTER_SITE_URL: "http://localhost:3000",
    OPENROUTER_APP_NAME: "AMS",
    OPENROUTER_REASONING_ENABLED: "true",
    OPENROUTER_REASONING_EFFORT: "low",
    OPENROUTER_REASONING_EXCLUDE: "false",
  });

  assert.equal(config.apiKey, "key");
  assert.equal(config.model, "qwen/qwen3-235b-a22b-thinking-2507");
  assert.deepEqual(config.modelKwargs, {
    reasoning: {
      enabled: true,
      effort: "low",
      exclude: false,
    },
  });
});
