import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent, registerHarnessProfile } from "deepagents";
import {
  contextEditingMiddleware,
  modelRetryMiddleware,
  toolCallLimitMiddleware,
} from "langchain";

import { frontendFailureGuardMiddleware } from "./frontend-failure-guard.js";
import {
  buildGroqChatModelConfig,
  buildOpenRouterChatModelConfig,
} from "./model-config.js";
import { openUiGeneratedPromptMiddleware } from "./openui-generated-prompt-middleware.js";
import { pageContextMiddleware } from "./page-context-middleware.js";
import {
  FRONTEND_CONTROLLER_PROMPT_TEMPLATE,
  ORCHESTRATOR_PROMPT_TEMPLATE,
  SQL_ANALYST_PROMPT_TEMPLATE,
} from "./prompts.js";
import { buildModelRetryMiddlewareConfig } from "./resilience.js";
import { createSqlAnalystTools } from "./sql-tools.js";
import {
  FRONTEND_CONTROLLER_TOOLS,
  ORCHESTRATOR_TOOLS,
} from "./tools.js";

const DEFAULT_TOOL_CALL_RUN_LIMIT = 70;
const DEEPAGENTS_BASE_PROMPT_OVERRIDE =
  "DeepAgents runtime is active. Follow the role-specific AMS system prompt exactly for response format, delegation, and user-visible output.";
const DISABLED_FILESYSTEM_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
];

function configuredPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function selectedModelProvider() {
  const configured = process.env.AGENT_MODEL_PROVIDER?.trim().toLowerCase();
  if (configured === "groq" || configured === "openrouter") return configured;
  if (process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) return "groq";
  return "openrouter";
}

function createOpenRouterModel() {
  return new ChatOpenAI(buildOpenRouterChatModelConfig());
}

function createGroqModel() {
  return new ChatOpenAI(buildGroqChatModelConfig());
}

function createAgentModel() {
  return selectedModelProvider() === "groq"
    ? createGroqModel()
    : createOpenRouterModel();
}

function runtimePrompt(prompt: string) {
  return prompt.replace("{system_time}", new Date().toISOString());
}

function createRuntimeMiddleware({
  includeFrontendGuard,
  includeOpenUiGeneratedPrompt,
  includePageContext,
  runLimit,
}: {
  includeFrontendGuard: boolean;
  includeOpenUiGeneratedPrompt: boolean;
  includePageContext: boolean;
  runLimit: number;
}) {
  return [
    modelRetryMiddleware(buildModelRetryMiddlewareConfig()),
    ...(includePageContext ? [pageContextMiddleware] : []),
    toolCallLimitMiddleware({
      runLimit,
      exitBehavior: "end",
    }),
    ...(includeFrontendGuard ? [frontendFailureGuardMiddleware] : []),
    contextEditingMiddleware(),
    ...(includeOpenUiGeneratedPrompt
      ? [openUiGeneratedPromptMiddleware]
      : []),
  ];
}

registerHarnessProfile("openai", {
  baseSystemPrompt: DEEPAGENTS_BASE_PROMPT_OVERRIDE,
  excludedTools: DISABLED_FILESYSTEM_TOOLS,
  generalPurposeSubagent: { enabled: false },
});

registerHarnessProfile("openrouter", {
  baseSystemPrompt: DEEPAGENTS_BASE_PROMPT_OVERRIDE,
  excludedTools: DISABLED_FILESYSTEM_TOOLS,
  generalPurposeSubagent: { enabled: false },
});

registerHarnessProfile("groq", {
  baseSystemPrompt: DEEPAGENTS_BASE_PROMPT_OVERRIDE,
  excludedTools: DISABLED_FILESYSTEM_TOOLS,
  generalPurposeSubagent: { enabled: false },
});

const toolCallRunLimit = configuredPositiveInt(
  process.env.AGENT_TOOL_CALL_RUN_LIMIT,
  DEFAULT_TOOL_CALL_RUN_LIMIT,
);
const model = createAgentModel();
const sqlAnalystTools = await createSqlAnalystTools(model);

const agent = createDeepAgent({
  name: "ams_copilot_orchestrator",
  model,
  tools: ORCHESTRATOR_TOOLS,
  subagents: [
    {
      name: "frontend_controller",
      description:
        "Use for AMS page reads, navigation, form filling, option resolution, frontend actions, and human-approved submit workflows.",
      systemPrompt: runtimePrompt(FRONTEND_CONTROLLER_PROMPT_TEMPLATE),
      model,
      tools: FRONTEND_CONTROLLER_TOOLS,
      middleware: createRuntimeMiddleware({
        includeFrontendGuard: true,
        includeOpenUiGeneratedPrompt: false,
        includePageContext: true,
        runLimit: toolCallRunLimit,
      }),
    },
    {
      name: "sql_analyst",
      description:
        "Use for complex AMS reporting, schema inspection, and SQL execution against the configured AMS database.",
      systemPrompt: SQL_ANALYST_PROMPT_TEMPLATE,
      model,
      tools: sqlAnalystTools,
      middleware: createRuntimeMiddleware({
        includeFrontendGuard: false,
        includeOpenUiGeneratedPrompt: false,
        includePageContext: false,
        runLimit: Math.min(toolCallRunLimit, 20),
      }),
    },
  ],
  middleware: createRuntimeMiddleware({
    includeFrontendGuard: false,
    includeOpenUiGeneratedPrompt: true,
    includePageContext: true,
    runLimit: toolCallRunLimit,
  }),
  systemPrompt: runtimePrompt(ORCHESTRATOR_PROMPT_TEMPLATE),
});

export const graph = agent.graph;
