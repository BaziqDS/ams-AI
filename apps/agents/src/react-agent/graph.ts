import { ChatOpenAI } from "@langchain/openai";
import {
  contextEditingMiddleware,
  createAgent,
  modelRetryMiddleware,
  toolCallLimitMiddleware,
  todoListMiddleware,
} from "langchain";

import { frontendFailureGuardMiddleware } from "./frontend-failure-guard.js";
import {
  buildGroqChatModelConfig,
  buildOpenRouterChatModelConfig,
} from "./model-config.js";
import { pageContextMiddleware } from "./page-context-middleware.js";
import { SYSTEM_PROMPT_TEMPLATE } from "./prompts.js";
import { buildModelRetryMiddlewareConfig } from "./resilience.js";
import { TOOLS } from "./tools.js";

const DEFAULT_TOOL_CALL_RUN_LIMIT = 70;

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

const agent = createAgent({
  model: createAgentModel(),
  tools: TOOLS,
  middleware: [
    modelRetryMiddleware(buildModelRetryMiddlewareConfig()),
    pageContextMiddleware,
    toolCallLimitMiddleware({
      runLimit: configuredPositiveInt(
        process.env.AGENT_TOOL_CALL_RUN_LIMIT,
        DEFAULT_TOOL_CALL_RUN_LIMIT,
      ),
      exitBehavior: "end",
    }),
    todoListMiddleware(),
    frontendFailureGuardMiddleware,
    contextEditingMiddleware(),
  ],
  systemPrompt: SYSTEM_PROMPT_TEMPLATE.replace(
    "{system_time}",
    new Date().toISOString(),
  ),
});

export const graph = agent.graph;
