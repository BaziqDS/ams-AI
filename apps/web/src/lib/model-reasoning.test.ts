import assert from "node:assert/strict";
import test from "node:test";

import { extractModelReasoningTelemetry } from "./model-reasoning";

test("extracts OpenRouter reasoning text from additional kwargs", () => {
  assert.deepEqual(
    extractModelReasoningTelemetry({
      additional_kwargs: {
        reasoning: "checked the active form and visible rows",
      },
    }),
    {
      text: "checked the active form and visible rows",
    },
  );
});

test("extracts streamed reasoning content and reasoning token usage", () => {
  assert.deepEqual(
    extractModelReasoningTelemetry({
      additional_kwargs: {
        reasoning_content: "planned the next frontend action",
      },
      response_metadata: {
        usage: {
          completion_tokens_details: {
            reasoning_tokens: 128,
          },
        },
      },
    }),
    {
      text: "planned the next frontend action",
      reasoningTokens: 128,
    },
  );
});

test("extracts LangChain reasoning content blocks", () => {
  assert.deepEqual(
    extractModelReasoningTelemetry({
      contentBlocks: [
        { type: "reasoning", reasoning: "checked tool result before replying" },
        { type: "text", text: "Hello" },
      ],
      usage_metadata: {
        output_token_details: {
          reasoning: 438,
        },
      },
    }),
    {
      text: "checked tool result before replying",
      reasoningTokens: 438,
    },
  );
});

test("ignores reasoning token usage when no reasoning content is available", () => {
  assert.equal(
    extractModelReasoningTelemetry({
      usage_metadata: {
        output_token_details: {
          reasoning: 438,
        },
      },
    }),
    null,
  );
});

test("ignores empty reasoning details", () => {
  assert.equal(
    extractModelReasoningTelemetry({
      additional_kwargs: {
        reasoning_details: [],
      },
      response_metadata: {
        usage: {
          completion_tokens_details: {
            reasoning_tokens: 438,
          },
        },
      },
    }),
    null,
  );
});

test("ignores messages without reasoning metadata", () => {
  assert.equal(
    extractModelReasoningTelemetry({
      content: "normal assistant response",
    }),
    null,
  );
});
