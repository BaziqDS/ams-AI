export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

type EnvLike = Record<string, string | undefined>;

export type OpenRouterReasoningConfig = {
  enabled: true;
  effort?: "low" | "medium" | "high";
  max_tokens?: number;
  exclude?: boolean;
};

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function parsePositiveInt(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function parseReasoningEffort(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }
  return undefined;
}

export function buildOpenRouterReasoningConfig(
  env: EnvLike = process.env,
): OpenRouterReasoningConfig | undefined {
  if (parseBoolean(env.OPENROUTER_REASONING_ENABLED) !== true) {
    return undefined;
  }

  const effort = parseReasoningEffort(env.OPENROUTER_REASONING_EFFORT);
  const maxTokens = parsePositiveInt(env.OPENROUTER_REASONING_MAX_TOKENS);
  const exclude = parseBoolean(env.OPENROUTER_REASONING_EXCLUDE);

  return {
    enabled: true,
    ...(effort ? { effort } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
  };
}

export function buildOpenRouterChatModelConfig(env: EnvLike = process.env) {
  const apiKey = env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required to run the agent.");
  }

  const reasoning = buildOpenRouterReasoningConfig(env);

  return {
    apiKey,
    model: env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    temperature: 0,
    ...(reasoning ? { modelKwargs: { reasoning } } : {}),
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": env.OPENROUTER_APP_NAME ?? "LangChain Agent Chat App",
      },
    },
  };
}

export function buildGroqChatModelConfig(env: EnvLike = process.env) {
  const apiKey = env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is required when AGENT_MODEL_PROVIDER=groq.",
    );
  }

  return {
    apiKey,
    model: env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    temperature: 0,
    configuration: {
      baseURL: GROQ_BASE_URL,
    },
  };
}
