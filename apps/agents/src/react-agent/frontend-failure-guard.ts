import { AIMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import {
  isObject,
  getCurrentRoute,
  getActiveFormId,
  getActivityContext,
  FORM_TARGETED_ACTION_NAMES,
  type PageContext,
} from "./page-context-utils.js";

type MessageLike = {
  name?: string;
  content?: unknown;
  tool_calls?: Array<{
    name?: string;
    args?: unknown;
  }>;
  kwargs?: {
    tool_calls?: Array<{
      name?: string;
      args?: unknown;
    }>;
  };
};

function messageContent(message: MessageLike | undefined) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

function getLastClosedForm(ctx: PageContext | undefined) {
  const closed = getActivityContext(ctx)?.lastClosedForm;
  return isObject(closed) ? closed : null;
}

function getLastSubmitResult(ctx: PageContext | undefined) {
  const submit = getActivityContext(ctx)?.lastSubmitResult;
  return isObject(submit) ? submit : null;
}

function textField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function unknownId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeFormId(value: string | null | undefined) {
  return value?.replace(/[-_]/g, "").toLowerCase() ?? null;
}

function formIdsMatch(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeFormId(left);
  const normalizedRight = normalizeFormId(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function submitRecordId(lastSubmit: Record<string, unknown>) {
  const result = lastSubmit.result;
  if (!isObject(result)) return null;
  return unknownId(result.recordId) ?? unknownId(result.id);
}

const FRESH_FORM_EVENT_KINDS = new Set([
  "form_opened",
  "form_field_changed",
  "form_values_set",
]);

/**
 * Returns true when the activity log shows a form was opened or filled
 * after the given timestamp. Used to distinguish a legitimate next-create
 * on a reusable create form (e.g. item-create for item 10 after item 9
 * was just saved) from a real duplicate submit attempt.
 */
function hasFreshFormActivitySince(
  ctx: PageContext | undefined,
  sinceIso: string | null | undefined,
): boolean {
  if (!sinceIso) return false;
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) return false;
  const activity = getActivityContext(ctx);
  if (!activity) return false;
  const recent = activity.recentActivity;
  if (!Array.isArray(recent)) return false;
  for (const event of recent) {
    if (!isObject(event)) continue;
    const at = typeof event.at === "string" ? Date.parse(event.at) : NaN;
    if (!Number.isFinite(at) || at <= sinceMs) continue;
    const kind = event.kind;
    if (typeof kind === "string" && FRESH_FORM_EVENT_KINDS.has(kind)) {
      return true;
    }
  }
  return false;
}

function lastClosedFormLabel(closed: Record<string, unknown> | null) {
  if (!closed) return null;
  return textField(closed, "title") ?? textField(closed, "formTitle") ?? textField(closed, "formId");
}

function getToolCalls(message: MessageLike | undefined) {
  return message?.tool_calls ?? message?.kwargs?.tool_calls ?? [];
}

function getToolCallFormId(toolCall: { args?: unknown }) {
  if (!isObject(toolCall.args)) return null;
  return typeof toolCall.args.formId === "string" ? toolCall.args.formId : null;
}

function isFrontendToolFailure(content: string) {
  return /^Frontend action "[^"]+" FAILED\./.test(content);
}

function isInvalidFormSchemaFailure(message: MessageLike | undefined) {
  const content = messageContent(message);
  return (
    message?.name === "set_form_values" &&
    isFrontendToolFailure(content) &&
    content.includes("errorType=invalid_form_values_schema")
  );
}

function isStaleFormContextFailure(message: MessageLike | undefined) {
  const content = messageContent(message);
  return (
    Boolean(message?.name) &&
    isFrontendToolFailure(content) &&
    content.includes("STALE_FORM_CONTEXT")
  );
}

function recentInvalidFormSchemaFailures(messages: MessageLike[]) {
  return messages.filter(isInvalidFormSchemaFailure).slice(-2);
}

function extractJsonObjectAfter(content: string, marker: string) {
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) return null;

  const start = content.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(content.slice(start, index + 1));
          return isObject(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function extractFieldErrors(content: string) {
  const parsed = extractJsonObjectAfter(content, "fieldErrors=");
  if (!parsed) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => {
      return typeof entry[0] === "string" && typeof entry[1] === "string";
    }),
  );
}

function extractAttemptedFields(content: string) {
  const match = content.match(/Fields:\s*([\s\S]*?)\.\s*$/);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean)
    .filter((field) => field !== "(none)");
}

function formatFields(fields: string[]) {
  if (fields.length === 0) return "the submitted fields";
  return fields.join(", ");
}

function extractStaleFormContext(content: string) {
  const targetForm = content.match(/targets stale form "([^"]+)"/i)?.[1];
  const currentPage = content.match(/current page \(([^)]+)\)/i)?.[1];
  const activeForm = content.match(/active AMS form is "([^"]+)"/i)?.[1];
  return {
    targetForm: targetForm ?? "the previous form",
    currentPage,
    activeForm,
  };
}

export function getFrontendFailureStopMessage(messages: MessageLike[]) {
  const lastMessage = messages.at(-1);
  const lastContent = messageContent(lastMessage);

  if (isStaleFormContextFailure(lastMessage)) {
    const { targetForm, currentPage, activeForm } =
      extractStaleFormContext(lastContent);
    const currentState = activeForm
      ? `the active form is ${activeForm}`
      : currentPage
        ? `the current page is ${currentPage} with no active AMS form`
        : "the current page does not expose that active form";
    return (
      `I cannot use ${targetForm} because ${currentState}. ` +
      "That form context is stale, so I will stop retrying it. Please open the relevant form, or ask me to navigate/open it before filling."
    );
  }

  const schemaFailures = recentInvalidFormSchemaFailures(messages);
  if (schemaFailures.length >= 2) {
    const latestContent = messageContent(schemaFailures.at(-1));
    const fieldErrors = extractFieldErrors(latestContent);
    const attemptedFields = extractAttemptedFields(latestContent);
    if ("values" in fieldErrors) {
      return (
        "I could not fill the form because the submitted patch did not match the active form's writable schema. " +
        `Attempted fields: ${formatFields(attemptedFields)}. ` +
        "I will stop retrying. I need to use only exact writable field names from the active form schema and resolve dropdown values from available options before patching."
      );
    }

    return (
      "I could not fill the form because the submitted row values do not match the writable field schema. " +
      "I will stop retrying. For inspection row fields, use exact dotted field names such as items.0.stock_register, not nested objects like items:{0:{...}}."
    );
  }

  return null;
}

export function getStaleFormToolCallStopMessage(
  messages: MessageLike[],
  pageContext: PageContext | undefined,
) {
  if (!pageContext) return null;

  const latestMessage = messages.at(-1);
  const latestToolCalls = getToolCalls(latestMessage);
  if (latestToolCalls.length === 0) return null;

  const currentRoute = getCurrentRoute(pageContext);
  const activeFormId = getActiveFormId(pageContext);
  const lastClosed = getLastClosedForm(pageContext);
  const lastSubmit = getLastSubmitResult(pageContext);

  for (const toolCall of latestToolCalls) {
    if (!toolCall.name || !FORM_TARGETED_ACTION_NAMES.has(toolCall.name)) {
      continue;
    }
    const targetFormId = getToolCallFormId(toolCall);
    if (toolCall.name === "request_form_submit" && lastSubmit?.ok === true) {
      const submittedFormId = textField(lastSubmit, "formId");
      const submittedFormTitle =
        textField(lastSubmit, "formTitle") ?? submittedFormId ?? "the previous form";
      const sameTarget = targetFormId
        ? formIdsMatch(submittedFormId, targetFormId)
        : !activeFormId || formIdsMatch(submittedFormId, activeFormId);
      if (sameTarget) {
        // Reusable create forms (item_create, category_create, location_create,
        // stock_entry_create, stock_register_create) share one static formId
        // across every record. Comparing only by formId would mis-flag the
        // next legitimate create as a duplicate of the previous one. So
        // before blocking, check the activity timeline: if a form was
        // opened or filled AFTER the last submit, the agent is working on
        // a fresh form instance, not re-submitting the saved record.
        const submittedAt = textField(lastSubmit, "at");
        if (hasFreshFormActivitySince(pageContext, submittedAt)) {
          continue;
        }
        const recordId = submitRecordId(lastSubmit);
        return (
          `I will not call request_form_submit for ${submittedFormTitle} because that form was already submitted successfully` +
          `${recordId ? ` for record ${recordId}` : ""}. ` +
          "I will not ask for approval to submit it again. I should continue from the current page or open the saved record instead."
        );
      }
    }

    if (!targetFormId) {
      if (toolCall.name === "request_form_submit" && !activeFormId) {
        const closedLabel = lastClosedFormLabel(lastClosed);
        return (
          `I will not call request_form_submit because the current page` +
          `${currentRoute ? ` is ${currentRoute}` : ""} has no active AMS form` +
          `${closedLabel ? `; the user closed ${closedLabel}` : ""}. ` +
          "I will not ask for approval for a form that is no longer open."
        );
      }
      continue;
    }
    if (activeFormId === targetFormId) continue;

    const currentState = activeFormId
      ? `the active form is ${activeFormId}`
      : currentRoute
        ? `the current page is ${currentRoute} with no active AMS form`
        : "there is no matching active AMS form in the current page context";
    return (
      `I will not call ${toolCall.name} for ${targetFormId} because ${currentState}. ` +
      "That would reuse stale form context, so I will not ask for approval or run the old form action. Open the relevant form first, or ask me to navigate/open it before filling."
    );
  }

  return null;
}

export const frontendFailureGuardMiddleware = createMiddleware({
  name: "FrontendFailureGuardMiddleware",
  afterModel: {
    canJumpTo: ["end"],
    hook: (state, runtime) => {
      const stopMessage = getStaleFormToolCallStopMessage(
        (state.messages ?? []) as MessageLike[],
        (runtime.configurable as { pageContext?: PageContext } | undefined)
          ?.pageContext,
      );
      if (!stopMessage) return undefined;
      return {
        jumpTo: "end",
        messages: [new AIMessage(stopMessage)],
      };
    },
  },
  beforeModel: {
    canJumpTo: ["end"],
    hook: (state) => {
      const stopMessage = getFrontendFailureStopMessage(
        (state.messages ?? []) as MessageLike[],
      );
      if (!stopMessage) return undefined;
      return {
        jumpTo: "end",
        messages: [new AIMessage(stopMessage)],
      };
    },
  },
});
