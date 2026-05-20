import { ChatOpenAI } from "@langchain/openai";
import { contextEditingMiddleware, createAgent } from "langchain";

import { formSubmitApprovalMiddleware } from "./approval-middleware.js";
import { pageContextMiddleware } from "./page-context-middleware.js";
import { SYSTEM_PROMPT_TEMPLATE } from "./prompts.js";
import { TOOLS } from "./tools.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function selectedModelProvider() {
  const configured = process.env.AGENT_MODEL_PROVIDER?.trim().toLowerCase();
  if (configured === "groq" || configured === "openrouter") return configured;
  if (process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) return "groq";
  return "openrouter";
}

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

function createGroqModel() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is required when AGENT_MODEL_PROVIDER=groq.",
    );
  }

  return new ChatOpenAI({
    apiKey,
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    temperature: 0,
    configuration: {
      baseURL: GROQ_BASE_URL,
    },
  });
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
