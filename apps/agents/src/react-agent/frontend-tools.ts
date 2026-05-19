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

const PROTECTED_FRONTEND_ACTIONS = new Set(["request_form_submit"]);

const formValuesSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "Map of field name to value. Values may be strings, numbers, booleans, nulls, objects, or arrays."
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
        `Frontend action "${name}" PARTIAL.`,
        unknown.length > 0
          ? `Unknown fields were not filled: ${unknown.join(", ")}.`
          : undefined,
        ignored.length > 0
          ? `Ignored fields were not filled: ${ignored.join(", ")}.`
          : undefined,
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
      "Use this for live form filling instead of rendering a chat form. Include only fields you intend to change.",
    schema: z.object({
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
        .describe(
          "Short reason for the patch, useful for audit/debug logging."
        ),
    }),
  }
);

export const focusFormField = tool(
  async ({ formId, field, reason }, config) => {
    const result = emitFrontendAction(config, "focus_form_field", {
      formId,
      field,
      reason,
    });
    return result.message;
  },
  {
    name: "focus_form_field",
    description:
      "Move focus to a specific field in the active browser form when the user needs to review or provide a value.",
    schema: z.object({
      formId: z
        .string()
        .optional()
        .describe("Optional target form id from page context."),
      field: z.string().describe("Exact field name from page context."),
      reason: z
        .string()
        .optional()
        .describe("Why this field needs user attention."),
    }),
  }
);

export const validateActiveForm = tool(
  async ({ formId }, config) => {
    const result = emitFrontendAction(config, "validate_active_form", {
      formId,
    });
    return result.message;
  },
  {
    name: "validate_active_form",
    description:
      "Ask the active browser form to run its local validation. Use after filling a form or before a submit request.",
    schema: z.object({
      formId: z
        .string()
        .optional()
        .describe("Optional target form id from page context."),
    }),
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
  focusFormField,
  validateActiveForm,
  requestFormSubmit,
  runFrontendAction,
  resolveRelativeDate,
];
