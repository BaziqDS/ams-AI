import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { interrupt } from "@langchain/langgraph";
import { tool } from "langchain";
import { z } from "zod";

type PageContext = {
  actions?: Array<{
    name?: string;
    allowed?: boolean;
    blockedReason?: string;
    description?: string;
    requiredPermissions?: string[];
    requiredCapabilities?: Array<{ module?: string; level?: string }>;
  }>;
};

type FrontendActionAccessOptions = {
  allowProtectedActions?: boolean;
  allowMissingRegisteredAction?: boolean;
  requireRegistered?: boolean;
};

type FrontendActionResume = {
  ok?: boolean;
  result?: unknown;
  error?: unknown;
};

const DEDICATED_FRONTEND_ACTIONS = new Map([
  ["set_form_values", "set_form_values"],
  ["request_form_submit", "request_form_submit"],
]);

const AGENT_HIDDEN_FRONTEND_ACTIONS = new Set([
  "focus_form_field",
  "validate_active_form",
]);

const PROTECTED_FRONTEND_ACTIONS = new Set(["request_form_submit"]);

export const formValuesSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'JSON object keyed by exact writable field names from the active form context. Never pass an array directly as "values". For repeatable rows, wrap the array under its field name, for example {"items":[{"central_register":1}]} or patch exact dotted fields such as {"items.0.central_register":1}.'
  );

export const setFormValuesArgsSchema = z
  .object({
    formId: z
      .string()
      .optional()
      .describe(
        "Optional target form id from page context. Omit to target the active form."
      ),
    values: formValuesSchema,
    reason: z
      .string()
      .optional()
      .describe("Short reason for the patch, useful for audit/debug logging."),
  })
  .strict()
  .describe(
    'Arguments for set_form_values. Shape must be {"formId":"...","values":{"fieldName":value},"reason":"..."}. The values property is always an object, never an array.'
  );

function getPageContext(config: LangGraphRunnableConfig | undefined) {
  return (config?.configurable as { pageContext?: PageContext } | undefined)
    ?.pageContext;
}

export function resolveFrontendActionAccess(
  config: LangGraphRunnableConfig | undefined,
  name: string,
  options: FrontendActionAccessOptions = {}
): { ok: true } | { ok: false; message: string } {
  if (
    options.allowProtectedActions === false &&
    PROTECTED_FRONTEND_ACTIONS.has(name)
  ) {
    return {
      ok: false,
      message: `Frontend action "${name}" must use the dedicated request_form_submit tool so human approval cannot be bypassed.`,
    };
  }

  if (
    options.allowProtectedActions === false &&
    DEDICATED_FRONTEND_ACTIONS.has(name)
  ) {
    const toolName = DEDICATED_FRONTEND_ACTIONS.get(name);
    return {
      ok: false,
      message:
        `Frontend action "${name}" must use the dedicated ${toolName} tool. ` +
        "Do not route dedicated form actions through run_frontend_action.",
    };
  }

  if (
    options.allowProtectedActions === false &&
    AGENT_HIDDEN_FRONTEND_ACTIONS.has(name)
  ) {
    return {
      ok: false,
      message:
        `Frontend action "${name}" is an internal form helper and is not exposed as an agent tool. ` +
        "Use set_form_values for form edits and request_form_submit when the user asks to save, submit, or advance workflow.",
    };
  }

  const actions = getPageContext(config)?.actions;
  if (!Array.isArray(actions)) {
    if (options.requireRegistered) {
      return {
        ok: false,
        message:
          `Frontend action "${name}" is not registered in the current page context. ` +
          "Ask the user to open the relevant form or screen first.",
      };
    }
    return { ok: true };
  }

  const action = actions.find((candidate) => candidate.name === name);
  if (!action) {
    if (options.allowMissingRegisteredAction) {
      return { ok: true };
    }
    return {
      ok: false,
      message:
        `Frontend action "${name}" is not registered in the current page context. ` +
        "Ask the user to open the relevant form or screen first.",
    };
  }

  if (action.allowed === false) {
    const requirements = [
      Array.isArray(action.requiredPermissions) &&
      action.requiredPermissions.length > 0
        ? `requiredPermissions=${renderResult(action.requiredPermissions)}`
        : undefined,
      Array.isArray(action.requiredCapabilities) &&
      action.requiredCapabilities.length > 0
        ? `requiredCapabilities=${renderResult(action.requiredCapabilities)}`
        : undefined,
    ].filter(Boolean);
    return {
      ok: false,
      message:
        `Frontend action "${name}" is not allowed for the signed-in user or current form state. ` +
        `${action.blockedReason ? `${action.blockedReason} ` : ""}` +
        `${requirements.length > 0 ? `${requirements.join(" ")} ` : ""}` +
        "Do not try to submit it. Explain the permission or form-state blocker to the user.",
    };
  }

  return { ok: true };
}

function emitFrontendAction(
  config: LangGraphRunnableConfig | undefined,
  name: string,
  args: Record<string, unknown>,
  options?: FrontendActionAccessOptions
) {
  const access = resolveFrontendActionAccess(config, name, options);
  if (!access.ok) return access;

  const resume = interrupt({
    type: "frontend_action_request",
    action: {
      name,
      args,
    },
  });

  return {
    ok: true,
    message: formatFrontendActionResult(name, resume),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renderResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringArrayField(
  value: Record<string, unknown>,
  key: string
): string[] {
  const field = value[key];
  if (!Array.isArray(field)) return [];
  return field
    .filter((item): item is string => typeof item === "string")
    .filter(Boolean);
}

export function formatFrontendActionResult(
  name: string,
  resume: unknown
): string {
  if (!isObject(resume)) {
    return `Frontend action "${name}" FAILED: no structured browser result was returned.`;
  }

  const typed = resume as FrontendActionResume;
  const result = typed.result;
  if (isObject(result) && result.ok === false) {
    const reasonText =
      typeof result.message === "string"
        ? result.message
        : typeof result.reason === "string"
          ? result.reason
          : undefined;
    const parts = [
      `Frontend action "${name}" FAILED.`,
      reasonText,
      result.errorType ? `errorType=${String(result.errorType)}` : undefined,
      result.fieldErrors
        ? `fieldErrors=${renderResult(result.fieldErrors)}`
        : undefined,
      result.globalErrors
        ? `globalErrors=${renderResult(result.globalErrors)}`
        : undefined,
      `Raw result: ${renderResult(result)}.`,
    ].filter(Boolean);
    return parts.join(" ");
  }

  if (typed.ok === false) {
    return `Frontend action "${name}" FAILED: ${renderResult(typed.error ?? "unknown error")}.`;
  }

  if (isObject(result) && result.ok === true) {
    const unknown = stringArrayField(result, "unknown");
    const ignored = stringArrayField(result, "ignored");
    if (unknown.length > 0 || ignored.length > 0) {
      const parts = [
        `Frontend action "${name}" PARTIAL - NOT SUCCESSFUL.`,
        unknown.length > 0
          ? `Unknown fields were not filled: ${unknown.join(", ")}.`
          : undefined,
        ignored.length > 0
          ? `Ignored fields were not filled: ${ignored.join(", ")}.`
          : undefined,
        `Do not describe the action as filled, saved, done, or successful unless the user-visible result was actually applied.`,
        `Result: ${renderResult(result)}.`,
      ].filter(Boolean);
      return parts.join(" ");
    }

    return `Frontend action "${name}" SUCCEEDED. Result: ${renderResult(result)}.`;
  }

  return (
    `Frontend action "${name}" completed but did not return a verified ok=true result. ` +
    `Treat this as unverified. Result: ${renderResult(result)}.`
  );
}

export const setFormValues = tool(
  async ({ formId, values, reason }, config) => {
    const result = emitFrontendAction(config, "set_form_values", {
      formId,
      values,
      reason,
    });

    if (!result.ok) return result.message;

    const fields = Object.keys(values ?? {});
    return `${result.message} Fields: ${fields.join(", ") || "(none)"}.`;
  },
  {
    name: "set_form_values",
    description:
      "Patch fields in the active browser form. Use exact field names from the Current page context. " +
      "Use this for live form filling instead of rendering a chat form. Include only fields you intend to change. " +
      'The tool args must be a single JSON object with a "values" object. Never pass an array directly as values; for row arrays use values.items = [...].',
    schema: setFormValuesArgsSchema,
  }
);

export const requestFormSubmit = tool(
  async ({ formId, intent }, config) => {
    const result = emitFrontendAction(
      config,
      "request_form_submit",
      {
        formId,
        intent,
      },
      {
        allowMissingRegisteredAction: true,
      }
    );
    return result.message;
  },
  {
    name: "request_form_submit",
    description:
      "Request save/submit of the active browser form only when the user explicitly asks. " +
      "For inspection workflow commands such as initiate, submit, approve, move to next stage, " +
      'or send it to the next stage, use intent "submit" against the active inspection detail/stage form. ' +
      'Use intent "save" only for saving progress. This requires human approval before execution. ' +
      "The frontend and backend still enforce permissions and validation.",
    schema: z.object({
      formId: z
        .string()
        .optional()
        .describe("Optional target form id from page context."),
      intent: z
        .enum(["save", "submit", "save_draft"])
        .optional()
        .describe("The user's explicit submit intent."),
    }),
  }
);

export const getAppMap = tool(
  async (_input, config) => {
    const result = emitFrontendAction(
      config,
      "get_app_map",
      {},
      {
        allowMissingRegisteredAction: true,
      }
    );
    return result.message;
  },
  {
    name: "get_app_map",
    description:
      "Return the current AMS app map: modules, list routes, create form ids, route patterns, required capabilities, and how to open forms. Use before guessing a route or form id.",
    schema: z.object({}),
  }
);

export const runFrontendAction = tool(
  async ({ name, args }, config) => {
    const safeArgs = args && typeof args === "object" ? args : {};
    const result = emitFrontendAction(config, name, safeArgs, {
      allowProtectedActions: false,
      requireRegistered: true,
    });
    if (!result.ok) return result.message;
    return `${result.message} Args: ${Object.keys(safeArgs).join(", ") || "(none)"}.`;
  },
  {
    name: "run_frontend_action",
    description:
      "Run a non-submit frontend action registered in the Current page context, such as opening a page modal. " +
      "Do not use this for request_form_submit; use the dedicated submit tool so human approval is enforced.",
    schema: z.object({
      name: z
        .string()
        .describe("Exact action name from the Current page context."),
      args: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional action arguments."),
    }),
  }
);

export const resolveRelativeDate = tool(
  async ({ phrase }) => {
    const now = new Date();
    const lower = phrase.toLowerCase().trim();

    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    const target = new Date(now);

    if (lower === "today") {
      // target = now
    } else if (lower === "tomorrow") {
      target.setDate(target.getDate() + 1);
    } else if (lower === "yesterday") {
      target.setDate(target.getDate() - 1);
    } else {
      const nextMatch = lower.match(/^next\s+(\w+)$/);
      const thisMatch = lower.match(/^this\s+(\w+)$/);
      const dayName = nextMatch?.[1] ?? thisMatch?.[1];
      if (dayName && dayName in dayMap) {
        const targetDay = dayMap[dayName];
        const currentDay = now.getDay();
        let diff = targetDay - currentDay;
        if (nextMatch) {
          if (diff <= 0) diff += 7;
        } else if (diff < 0) diff += 7;
        target.setDate(target.getDate() + diff);
      } else {
        const inDaysMatch = lower.match(/^in\s+(\d+)\s+days?$/);
        if (inDaysMatch) {
          target.setDate(target.getDate() + parseInt(inDaysMatch[1], 10));
        } else {
          return `Could not parse "${phrase}". Try: today, tomorrow, next Friday, in 5 days.`;
        }
      }
    }

    return target.toISOString().split("T")[0];
  },
  {
    name: "resolve_relative_date",
    description:
      "Convert relative date phrases such as today, tomorrow, next Friday, or in 5 days into YYYY-MM-DD before filling date fields.",
    schema: z.object({
      phrase: z.string().describe("The relative date phrase."),
    }),
  }
);

export const FRONTEND_TOOLS = [
  setFormValues,
  requestFormSubmit,
  getAppMap,
  runFrontendAction,
  resolveRelativeDate,
];
