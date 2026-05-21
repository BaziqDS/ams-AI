export type ModelReasoningTelemetry = {
  text?: string;
  details?: unknown;
  reasoningTokens?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedRecord(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : undefined;
}

function hasDisplayableDetails(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function reasoningFromSummary(value: unknown) {
  const summary = arrayValue(value);
  if (!summary) return undefined;

  return summary
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isRecord(item)) return "";
      return stringValue(item.text) ?? stringValue(item.summary_text) ?? "";
    })
    .filter(Boolean)
    .join("\n\n") || undefined;
}

function reasoningTextFromBlocks(value: unknown) {
  const blocks = arrayValue(value);
  if (!blocks) return undefined;

  return blocks
    .map((block) => {
      if (!isRecord(block) || block.type !== "reasoning") return "";
      return (
        stringValue(block.reasoning) ??
        stringValue(block.text) ??
        reasoningFromSummary(block.summary) ??
        ""
      );
    })
    .filter(Boolean)
    .join("\n\n") || undefined;
}

export function extractModelReasoningTelemetry(
  message: unknown,
): ModelReasoningTelemetry | null {
  if (!isRecord(message)) return null;

  const additional =
    nestedRecord(message, "additional_kwargs") ??
    nestedRecord(nestedRecord(message, "kwargs"), "additional_kwargs");
  const responseMetadata =
    nestedRecord(message, "response_metadata") ??
    nestedRecord(nestedRecord(message, "kwargs"), "response_metadata");
  const usageMetadata =
    nestedRecord(message, "usage_metadata") ??
    nestedRecord(nestedRecord(message, "kwargs"), "usage_metadata");

  const text =
    stringValue(message.reasoning) ??
    stringValue(additional?.reasoning) ??
    stringValue(additional?.reasoning_content) ??
    reasoningTextFromBlocks(message.contentBlocks) ??
    reasoningTextFromBlocks(message.content_blocks) ??
    reasoningTextFromBlocks(message.content);
  const rawDetails =
    additional?.reasoning_details ??
    message.reasoning_details ??
    responseMetadata?.reasoning_details;
  const details = hasDisplayableDetails(rawDetails) ? rawDetails : undefined;

  const usage = nestedRecord(responseMetadata, "usage");
  const completionDetails = nestedRecord(usage, "completion_tokens_details");
  const outputDetails = nestedRecord(usageMetadata, "output_token_details");
  const reasoningTokens =
    numberValue(completionDetails?.reasoning_tokens) ??
    numberValue(outputDetails?.reasoning);

  if (!text && details === undefined) {
    return null;
  }

  return {
    ...(text ? { text } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}
