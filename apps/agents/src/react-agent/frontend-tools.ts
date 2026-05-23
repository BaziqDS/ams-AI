import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { interrupt } from "@langchain/langgraph";
import { tool } from "langchain";
import { z } from "zod";
import {
  isObject,
  getCurrentRoute,
  getActiveForm,
  getPageContextFromConfig,
  AGENT_HIDDEN_FRONTEND_ACTIONS,
  FORM_TARGETED_ACTION_NAMES,
  type PageContext,
} from "./page-context-utils.js";

type FrontendActionAccessOptions = {
  allowProtectedActions?: boolean;
  allowMissingRegisteredAction?: boolean;
  requireRegistered?: boolean;
  targetFormId?: string;
};

type FrontendActionResume = {
  ok?: boolean;
  result?: unknown;
  error?: unknown;
};

type LangGraphScratchpadLike = {
  interruptCounter?: unknown;
  resume?: unknown;
  nullResume?: unknown;
};

const DEDICATED_FRONTEND_ACTIONS = new Map([
  ["set_form_values", "set_form_values"],
  ["search_form_options", "search_form_options"],
  ["request_form_submit", "request_form_submit"],
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

export const searchFormOptionsArgsSchema = z
  .object({
    formId: z
      .string()
      .optional()
      .describe(
        "Optional target form id from page context. Omit to target the active form."
      ),
    field: z
      .string()
      .min(1)
      .describe(
        "Exact option field name from activeForm.fields. For row fields, use dotted paths such as items.0.item or items.0.instances."
      ),
    query: z
      .string()
      .optional()
      .describe(
        "User-provided label, code, serial, or name to resolve. Omit or pass empty text to return leading candidates."
      ),
    currentValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Known or planned form values for dependency-aware option resolution, such as source store before item lookup."
      ),
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe("Maximum candidate options to return."),
    reason: z
      .string()
      .optional()
      .describe("Short reason for audit/debug logging."),
  })
  .strict()
  .describe(
    "Arguments for search_form_options. Use this to resolve human text to canonical form option values before set_form_values."
  );

function isFrontendActionResume(value: unknown) {
  if (!isObject(value)) return false;
  const action = value.action;
  return (
    (value.ok === true || value.ok === false) &&
    isObject(action) &&
    typeof action.name === "string"
  );
}

export function hasPendingInterruptResume(
  config: LangGraphRunnableConfig | undefined
) {
  const scratchpad = (config?.configurable as
    | { __pregel_scratchpad?: LangGraphScratchpadLike }
    | undefined)?.__pregel_scratchpad;
  if (!scratchpad || typeof scratchpad !== "object") return false;

  const interruptCounter =
    typeof scratchpad.interruptCounter === "number"
      ? scratchpad.interruptCounter
      : -1;
  const nextInterruptIndex = interruptCounter + 1;
  if (
    Array.isArray(scratchpad.resume) &&
    scratchpad.resume.length > nextInterruptIndex &&
    isFrontendActionResume(scratchpad.resume[nextInterruptIndex])
  ) {
    return true;
  }

  return isFrontendActionResume(scratchpad.nullResume);
}

function validateTargetForm(
  ctx: PageContext | undefined,
  name: string,
  targetFormId: string | undefined
): { ok: true } | { ok: false; message: string } {
  if (!targetFormId || !FORM_TARGETED_ACTION_NAMES.has(name)) {
    return { ok: true };
  }

  if (!ctx) return { ok: true };

  const currentRoute = getCurrentRoute(ctx);
  const activeForm = getActiveForm(ctx);
  if (!activeForm) {
    return {
      ok: false,
      message:
        `Frontend action "${name}" FAILED. STALE_FORM_CONTEXT: targets stale form "${targetFormId}", but the current page` +
        `${currentRoute ? ` (${currentRoute})` : ""} has no active AMS form. ` +
        "Do not retry stale form actions. Use the live page state: open the relevant form, navigate back to the target record, or ask the user to confirm the intended screen.",
    };
  }

  if (activeForm.formId !== targetFormId) {
    return {
      ok: false,
      message:
        `Frontend action "${name}" FAILED. STALE_FORM_CONTEXT: targets stale form "${targetFormId}", but the active AMS form is "${activeForm.formId}"` +
        `${activeForm.title ? ` (${activeForm.title})` : ""}` +
        `${currentRoute || activeForm.route ? ` on ${currentRoute ?? activeForm.route}` : ""}. ` +
        "Do not retry stale form actions. Use the current active form, open the target form first, or ask the user to confirm the intended screen.",
    };
  }

  return { ok: true };
}

export function resolveFrontendActionAccess(
  config: LangGraphRunnableConfig | undefined,
  name: string,
  options: FrontendActionAccessOptions = {}
): { ok: true } | { ok: false; message: string } {
  const ctx = getPageContextFromConfig(config);
  const formAccess = validateTargetForm(ctx, name, options.targetFormId);
  if (!formAccess.ok) return formAccess;

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

  const actions = ctx?.actions;
  if (!Array.isArray(actions)) {
    if (options.requireRegistered || name === "request_form_submit") {
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
    if (options.allowMissingRegisteredAction && name !== "request_form_submit") {
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

export function emitFrontendAction(
  config: LangGraphRunnableConfig | undefined,
  name: string,
  args: Record<string, unknown>,
  options?: FrontendActionAccessOptions,
  interruptFn: (value: unknown) => unknown = interrupt
) {
  if (!hasPendingInterruptResume(config)) {
    const formId = args.formId;
    const access = resolveFrontendActionAccess(config, name, {
      ...options,
      targetFormId: typeof formId === "string" ? formId : options?.targetFormId,
    });
    if (!access.ok) return access;
  }

  const resume = interruptFn({
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

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function summarizeOptionCandidates(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const labels = value
    .slice(0, 5)
    .map((candidate) => {
      if (!isObject(candidate)) return String(candidate);
      const label = candidate.label ?? candidate.value;
      return String(label ?? "");
    })
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : undefined;
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
    const status = stringField(result, "status");
    const field = stringField(result, "field");
    const query = stringField(result, "query");
    const optionsState = stringField(result, "optionsState");
    const totalCount = numberField(result, "totalCount");
    const missingDependencies = Array.isArray(result.missingDependencies)
      ? result.missingDependencies.map(String).filter(Boolean)
      : [];
    const candidateSummary = summarizeOptionCandidates(result.candidates);
    const isEmptyOptionResult =
      name === "search_form_options" &&
      (
        optionsState === "empty" ||
        (status === "not_found" && totalCount === 0)
      );
    const isOptionNotFoundResult =
      name === "search_form_options" &&
      status === "not_found" &&
      !isEmptyOptionResult;
    const isInstanceOptionQueryMismatch =
      isOptionNotFoundResult &&
      typeof field === "string" &&
      /\.instances$/.test(field) &&
      typeof query === "string" &&
      query.trim().length > 0 &&
      typeof totalCount === "number" &&
      totalCount > 0;
    const isBatchOptionQueryMismatch =
      isOptionNotFoundResult &&
      typeof field === "string" &&
      /\.batch$/.test(field) &&
      typeof query === "string" &&
      query.trim().length > 0 &&
      typeof totalCount === "number" &&
      totalCount > 0;
    const isRegisterOptionQueryMismatch =
      isOptionNotFoundResult &&
      typeof field === "string" &&
      /\.(?:stock_register|central_register)$/.test(field) &&
      typeof query === "string" &&
      query.trim().length > 0 &&
      typeof totalCount === "number" &&
      totalCount > 0;
    const isAmbiguousOptionResult =
      name === "search_form_options" &&
      status === "ambiguous";
    const isMissingOptionDependenciesResult =
      name === "search_form_options" &&
      (status === "missing_dependencies" || optionsState === "requires_dependency");
    const isInvalidFormValuesSchema =
      name === "set_form_values" &&
      result.errorType === "invalid_form_values_schema";
    const fieldErrors = isObject(result.fieldErrors)
      ? result.fieldErrors
      : undefined;
    const isRootFormValuesSchemaError =
      isInvalidFormValuesSchema && Boolean(fieldErrors?.values);
    const isInvalidSelectValue =
      name === "set_form_values" &&
      result.errorType === "invalid_select_value";
    const suppressRawResult =
      isEmptyOptionResult ||
      isOptionNotFoundResult ||
      isAmbiguousOptionResult ||
      isMissingOptionDependenciesResult ||
      isInvalidFormValuesSchema ||
      isInvalidSelectValue;
    const parts = [
      `Frontend action "${name}" FAILED.`,
      isInstanceOptionQueryMismatch
        ? `INSTANCE_OPTION_QUERY_MISMATCH: ${field} instances are serial/QR options for the selected item, not item-name options. Query${query ? ` "${query}"` : ""} did not match any instance identifier, but ${totalCount} instance option(s) exist. Resolve and set ${field.replace(/\.instances$/, ".item")} first if needed, then search ${field} by serial number/QR code or use an empty query to list available instances. Do not ask the user to create the item just because the instance query used an item name.`
        : undefined,
      isBatchOptionQueryMismatch
        ? `BATCH_OPTION_QUERY_MISMATCH: ${field} batches are batch-number options for the selected item, not item-name options. Query${query ? ` "${query}"` : ""} did not match any batch identifier, but ${totalCount} batch option(s) exist. Resolve and set ${field.replace(/\.batch$/, ".item")} first if needed, then search ${field} by batch number or use an empty query to list available batches. Do not ask the user to create the item just because the batch query used an item name.`
        : undefined,
      isRegisterOptionQueryMismatch
        ? `REGISTER_OPTION_QUERY_MISMATCH: ${field} register fields use register numbers/codes, not item-name options. Query${query ? ` "${query}"` : ""} did not match any register identifier, but ${totalCount} register option(s) exist. Resolve and set ${field.replace(/\.(?:stock_register|central_register)$/, ".item")} and required parent fields first if needed, then search ${field} by register number/code or use an empty query to list available registers. Do not ask the user to create the item just because the register query used an item name.`
        : undefined,
      isEmptyOptionResult
        ? `EMPTY_OPTIONS: the active form has no available options${field ? ` for ${field}` : ""}. Do not guess an ID or use SQL to bypass the form. Tell the user this option does not exist yet, and offer to help create it — use OpenUI with a Button to navigate to the relevant create form (e.g., location_create, category_create, item_create). Check module manifest and permissions to determine which create form to offer.`
        : undefined,
      isOptionNotFoundResult && !isInstanceOptionQueryMismatch && !isBatchOptionQueryMismatch && !isRegisterOptionQueryMismatch
        ? `OPTION_NOT_FOUND: requested option${query ? ` "${query}"` : ""} is not available${field ? ` for ${field}` : ""}.${candidateSummary ? ` Available alternatives: ${candidateSummary}.` : ""}${typeof totalCount === "number" ? ` (${totalCount} option(s) exist)` : ""} Do not guess an ID or silently substitute a default. Present the available alternatives to the user using OpenUI (Buttons or a compact list). Also offer to create${query ? ` "${query}"` : " the missing option"} if the user has the required capability — use a Button that navigates to the relevant create form.`
        : undefined,
      isAmbiguousOptionResult
        ? `AMBIGUOUS_FORM_OPTIONS: query${query ? ` "${query}"` : ""} matched multiple options${field ? ` for ${field}` : ""}.${candidateSummary ? ` Candidates: ${candidateSummary}.` : ""} Present these candidates to the user using OpenUI Buttons so they can pick the right one. Do not guess which one to use.`
        : undefined,
      isMissingOptionDependenciesResult
        ? `OPTION_DEPENDENCIES_MISSING: cannot search${field ? ` ${field}` : " this field"} yet.${missingDependencies.length > 0 ? ` Fill these first: ${renderResult(missingDependencies)}.` : ""} Fill the dependency field(s) using set_form_values, then retry the search.`
        : undefined,
      isInvalidSelectValue
        ? "NON_RETRYABLE_INVALID_SELECT_VALUE: one or more select fields used values that are not available in the active form options. Do not retry, do not guess an ID, and do not use SQL to bypass the form. The missing option must be created or enabled first, or the user must choose an existing option."
        : undefined,
      isInvalidFormValuesSchema
        ? isRootFormValuesSchemaError
          ? "Use exact writable field names from activeForm.setValuesSchema. The submitted patch contains unknown fields or values with the wrong top-level shape."
          : "Use exact writable field names from activeForm.setValuesSchema. For inspection row fields, prefer dotted keys such as items.0.stock_register instead of nested objects like items:{0:{...}}."
        : undefined,
      reasonText,
      result.errorType ? `errorType=${String(result.errorType)}` : undefined,
      fieldErrors
        ? `fieldErrors=${renderResult(fieldErrors)}`
        : undefined,
      result.globalErrors
        ? `globalErrors=${renderResult(result.globalErrors)}`
        : undefined,
      field ? `field=${field}` : undefined,
      query ? `query=${query}` : undefined,
      status ? `status=${status}` : undefined,
      totalCount !== undefined ? `totalCount=${totalCount}` : undefined,
      suppressRawResult ? undefined : `Raw result: ${renderResult(result)}.`,
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
      "Patch fields in the active browser form. Use this when the active form is open, the target formId matches the current page context, and you have exact writable field names from activeForm.setValuesSchema. " +
      "Use this for live form filling instead of rendering a chat form, and include only fields you intend to change. " +
      "For select/dropdown/foreign-key fields, use search_form_options first whenever the user explicitly named the desired option or the field options are truncated, remote, dependency-based, or resolver-backed. " +
      "Do not use this to guess IDs, send display labels into select fields, rely on default/current/auto-selected values as substitutes for user-requested options, bypass missing options, submit forms, open forms, or patch stale forms from another page. " +
      'The tool args must be a single JSON object with a "values" object. Never pass an array directly as values; for row arrays use values.items = [...].',
    schema: setFormValuesArgsSchema,
  }
);

export const searchFormOptions = tool(
  async ({ formId, field, query, currentValues, limit, reason }, config) => {
    const result = emitFrontendAction(config, "search_form_options", {
      formId,
      field,
      query,
      currentValues,
      limit,
      reason,
    });

    return result.message;
  },
  {
    name: "search_form_options",
    description:
      "Resolve user text against active browser form options and return canonical option values for set_form_values. " +
      "Use this before set_form_values whenever the user explicitly named a select/dropdown/foreign-key option such as a location, department, category, item, person, stock register, batch, instance, serial, or code. " +
      "Use this when activeForm fields show optionsState truncated, requires_dependency, loading, remote_search, or resolver=search_form_options, and pass currentValues for dependency-aware lookups. " +
      "Use dotted row fields such as items.0.item or items.0.instances. " +
      "For batch fields such as items.0.batch, first resolve/set the row item via items.0.item; then search batches by batch number, or use an empty query to list available batches. Do not search a batch field with the item name. " +
      "For instance fields such as items.0.instances, first resolve/set the row item via items.0.item; then search instances by serial number/QR code, or use an empty query to list available instances. Do not search an instance field with the item name. " +
      "For register fields such as items.0.stock_register or items.0.central_register, search by register number/code, or use an empty query to list available registers. Do not search a register field with the item name. " +
      "Treat not_found, ambiguous, missing_dependencies, empty options, or no selected value as a hard blocker: do not guess option IDs, dropdown indexes, hidden values, use SQL to bypass the form, or rely on a default/current/auto-selected value unless it exactly matches the user's requested option. " +
      "Do not use this for free-text fields, broad database reporting, submitting forms, or actions not tied to the active form.",
    schema: searchFormOptionsArgsSchema,
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
        requireRegistered: true,
      }
    );
    return result.message;
  },
  {
    name: "request_form_submit",
    description:
      "Request save/submit of the active browser form only when the user explicitly asks or gives a workflow command. " +
      "Use this when the active form is the correct current form, required user-provided values have been filled, and all user-named dropdown/foreign-key options have been resolved against active form options. " +
      "For inspection workflow commands such as initiate, submit, approve, move to next stage, " +
      'or send it to the next stage, use intent "submit" against the active inspection detail/stage form. ' +
      'Use intent "save" only for saving progress. Do not use this if a requested option is unresolved, not_found, ambiguous, missing, or only satisfied by a default/current/auto-selected value that does not exactly match the user request. ' +
      "Do not use this to bypass set_form_values errors, stale form context, missing permissions, or missing required fields. This requires human approval before execution. " +
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
      "Return the current AMS app map: modules, list routes, create form ids, route patterns, required capabilities, and how to open forms. Use this when you need to discover the correct route or form id before navigating/opening a form. Do not use this to inspect active form fields, resolve dropdown options, submit forms, or replace the live page context; activeForm and route-scoped readables are more authoritative once present.",
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
      "Run a non-submit frontend action registered in the Current page context. Use this when the live page context lists the exact action and you need that page action, such as open_form, navigate_to_route, or opening/closing a create/edit modal. " +
      "Do not use this for request_form_submit, set_form_values, or search_form_options; use the dedicated tools so approval, form schema validation, option resolution, and stale-form checks are enforced. " +
      "Do not use this to invent filter/pagination actions that are not registered, bypass missing permissions, bypass missing dropdown options, or run stale actions from a previous page.",
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
      "Convert relative date phrases such as today, tomorrow, next Friday, or in 5 days into YYYY-MM-DD before filling date fields. Use this only for date fields when the user provided a relative date. Do not use this for dropdowns, IDs, free-text names, or database lookups.",
    schema: z.object({
      phrase: z.string().describe("The relative date phrase."),
    }),
  }
);

export const FRONTEND_TOOLS = [
  setFormValues,
  searchFormOptions,
  requestFormSubmit,
  getAppMap,
  runFrontendAction,
  resolveRelativeDate,
];
