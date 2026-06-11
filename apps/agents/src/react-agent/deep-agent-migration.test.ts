import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  FRONTEND_CONTROLLER_PROMPT_TEMPLATE,
  ORCHESTRATOR_PROMPT_TEMPLATE,
  SQL_ANALYST_PROMPT_TEMPLATE,
} from "./prompts.js";
import { ORCHESTRATOR_TOOLS } from "./tools.js";

const graphSource = readFileSync(
  join(process.cwd(), "src", "react-agent", "graph.ts"),
  "utf8",
);
const frontendToolsSource = readFileSync(
  join(process.cwd(), "src", "react-agent", "frontend-tools.ts"),
  "utf8",
);
const openUiMiddlewareSource = readFileSync(
  join(process.cwd(), "src", "react-agent", "openui-generated-prompt-middleware.ts"),
  "utf8",
);

test("graph uses DeepAgents with frontend and SQL subagents only", () => {
  assert.match(graphSource, /createDeepAgent/);
  assert.match(graphSource, /registerHarnessProfile/);
  assert.match(graphSource, /baseSystemPrompt:\s*DEEPAGENTS_BASE_PROMPT_OVERRIDE/);
  assert.match(graphSource, /excludedTools/);
  assert.match(graphSource, /openUiGeneratedPromptMiddleware/);
  assert.match(graphSource, /name:\s*"frontend_controller"/);
  assert.match(graphSource, /name:\s*"sql_analyst"/);
  assert.doesNotMatch(graphSource, /ams_analyst/);
  assert.doesNotMatch(graphSource, /createFilesystemToolExclusionMiddleware/);
});

test("orchestrator keeps direct tools small and delegates specialist work", () => {
  const toolNames = ORCHESTRATOR_TOOLS.map((tool) => tool.name);

  assert.deepEqual(toolNames, ["get_current_time"]);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /frontend_controller/);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /sql_analyst/);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /task tool/);
  assert.doesNotMatch(ORCHESTRATOR_PROMPT_TEMPLATE, /ams_analyst/);
});

test("frontend controller and SQL analyst have separate prompt ownership", () => {
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /frontend_controller subagent/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /AMS browser\/page actions/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /Each item belongs to a category/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /per-location ledgers/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /Do not use SQL tools/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /You own field mapping and verification/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /non-authoritative hints/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /verify the active form, writable field names/i);
  assert.match(FRONTEND_CONTROLLER_PROMPT_TEMPLATE, /not the visible final assistant/i);

  assert.match(SQL_ANALYST_PROMPT_TEMPLATE, /sql_analyst subagent/i);
  assert.match(SQL_ANALYST_PROMPT_TEMPLATE, /LangChain SQL tools/i);
  assert.match(SQL_ANALYST_PROMPT_TEMPLATE, /Do not use frontend action tools/i);
  assert.match(SQL_ANALYST_PROMPT_TEMPLATE, /Do NOT emit OpenUI yourself/);
});

test("orchestrator delegates frontend intent instead of dictating form patches", () => {
  assert.match(
    ORCHESTRATOR_PROMPT_TEMPLATE,
    /pass the user's BUSINESS GOAL and any user-provided facts/i,
  );
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /Do NOT design tool calls/);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /ORCHESTRATOR NEVER PRESCRIBES PAYLOADS/);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /The subagents own all execution detail/i);
});

test("orchestrator owns visible todos for long running delegated work", () => {
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /long-running or multi-step user goals/i);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /write_todos/);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /root orchestrator level/i);
  assert.match(ORCHESTRATOR_PROMPT_TEMPLATE, /Subagent todos are private planning state/i);
});

test("frontend tool errors report facts instead of asking subagents for OpenUI", () => {
  assert.doesNotMatch(frontendToolsSource, /using OpenUI/i);
  assert.doesNotMatch(frontendToolsSource, /OpenUI Buttons/i);
});

test("orchestrator appends OpenUI's generated prompt instead of a custom OpenUI prompt", () => {
  assert.match(openUiMiddlewareSource, /AMS_OPENUI_SYSTEM_PROMPT/);
  assert.doesNotMatch(openUiMiddlewareSource, /visible_response_contract/);
  assert.doesNotMatch(openUiMiddlewareSource, /valid openui-lang code beginning with root =/i);
  assert.match(
    ORCHESTRATOR_PROMPT_TEMPLATE,
    /valid OpenUI starting with \\?`root =\\?`/i,
  );
});
