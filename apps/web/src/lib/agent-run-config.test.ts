import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentRunConfig } from "./agent-run-config";

test("agent run config uses the LangGraph SDK recursion_limit key while preserving page context", () => {
  const pageContext = { readables: [], actions: [] };

  assert.deepEqual(buildAgentRunConfig(pageContext), {
    recursion_limit: 80,
    configurable: {
      pageContext,
    },
  });
});
