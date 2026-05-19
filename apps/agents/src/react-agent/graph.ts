import { ChatOpenAI } from "@langchain/openai";
import { contextEditingMiddleware, createAgent } from "langchain";

import { formSubmitApprovalMiddleware } from "./approval-middleware.js";
import { pageContextMiddleware } from "./page-context-middleware.js";
import { SYSTEM_PROMPT_TEMPLATE } from "./prompts.js";
import { TOOLS } from "./tools.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function createOpenRouterModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required to run the agent.");
  }

  return new ChatOpenAI({
    apiKey,
    model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    temperature: 0,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "LangChain Agent Chat App",
      },
    },
  });
}

const agent = createAgent({
  model: createOpenRouterModel(),
  tools: TOOLS,
  middleware: [
    pageContextMiddleware,
    formSubmitApprovalMiddleware,
    contextEditingMiddleware(),
  ],
  systemPrompt: SYSTEM_PROMPT_TEMPLATE.replace(
    "{system_time}",
    new Date().toISOString(),
  ),
});

export const graph = agent.graph;
