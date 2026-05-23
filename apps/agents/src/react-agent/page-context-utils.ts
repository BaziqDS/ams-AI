export type PageContextReadable = {
  id?: string;
  description?: string;
  value?: unknown;
};

export type PageContextAction = {
  name?: string;
  allowed?: boolean;
  blockedReason?: string;
  description?: string;
  requiredPermissions?: string[];
  requiredCapabilities?: Array<{ module?: string; level?: string }>;
  parameters?: Record<string, unknown>;
};

export type PageContext = {
  readables?: PageContextReadable[];
  actions?: PageContextAction[];
};

export const RUNTIME_READABLE_ID = "__ams_runtime_context";
export const ACTIVITY_READABLE_ID = "__ams_activity_context";
export const PERMISSION_READABLE_ID = "__ams_permission_context";

export const AGENT_HIDDEN_FRONTEND_ACTIONS = new Set([
  "focus_form_field",
  "validate_active_form",
]);

export const FORM_TARGETED_ACTION_NAMES = new Set([
  "set_form_values",
  "search_form_options",
  "request_form_submit",
]);

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getCurrentRoute(ctx: PageContext | undefined): string | null {
  const runtime = ctx?.readables?.find(
    (readable) => readable.id === RUNTIME_READABLE_ID,
  )?.value;
  if (!isObject(runtime)) return null;
  const route = runtime.route;
  if (!isObject(route)) return null;
  return typeof route.pathname === "string" ? route.pathname : null;
}

export function getActiveForm(ctx: PageContext | undefined) {
  for (const readable of ctx?.readables ?? []) {
    if (!isObject(readable.value)) continue;
    const activeForm = readable.value.activeForm;
    if (!isObject(activeForm)) continue;
    const formId = activeForm.formId;
    if (typeof formId !== "string" || formId.length === 0) continue;
    return {
      formId,
      title:
        typeof activeForm.title === "string" ? activeForm.title : undefined,
      route:
        typeof readable.value.route === "string"
          ? readable.value.route
          : undefined,
    };
  }
  return null;
}

export function getActiveFormId(ctx: PageContext | undefined): string | null {
  return getActiveForm(ctx)?.formId ?? null;
}

export function getActivityContext(ctx: PageContext | undefined) {
  const activity = ctx?.readables?.find(
    (readable) => readable.id === ACTIVITY_READABLE_ID,
  )?.value;
  return isObject(activity) ? activity : null;
}

export function getPageContextFromConfig(
  config: { configurable?: unknown } | undefined,
): PageContext | undefined {
  return (config?.configurable as { pageContext?: PageContext } | undefined)
    ?.pageContext;
}
