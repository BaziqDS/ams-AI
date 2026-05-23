import { dynamicSystemPromptMiddleware } from "langchain";
import { getFormWorkflowGuidance } from "./form-workflows.js";
import {
  isObject,
  RUNTIME_READABLE_ID,
  ACTIVITY_READABLE_ID,
  PERMISSION_READABLE_ID,
  AGENT_HIDDEN_FRONTEND_ACTIONS,
  type PageContext,
  type PageContextAction,
} from "./page-context-utils.js";

type Readable = { id: string; description: string; value: unknown };
type ActionDef = PageContextAction & {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const SYSTEM_READABLE_IDS = new Set([
  RUNTIME_READABLE_ID,
  ACTIVITY_READABLE_ID,
  PERMISSION_READABLE_ID,
]);

type CompactOptions = {
  arrayLimit?: number;
  objectKeyLimit?: number;
  maxDepth?: number;
};

function isSystemReadable(readable: Readable): boolean {
  return SYSTEM_READABLE_IDS.has(readable.id);
}

function hasPendingDependencies(field: Record<string, unknown>): boolean {
  return (
    Array.isArray(field.missingDependencies) &&
    field.missingDependencies.length > 0
  );
}

function compactForPrompt(
  value: unknown,
  options: CompactOptions = {},
  depth = 0,
): unknown {
  const arrayLimit = options.arrayLimit ?? 8;
  const objectKeyLimit = options.objectKeyLimit ?? 16;
  const maxDepth = options.maxDepth ?? 4;

  if (value === null || value === undefined) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= maxDepth) {
    return Array.isArray(value)
      ? `[${value.length} items]`
      : isObject(value)
        ? "{...}"
        : String(value);
  }
  if (Array.isArray(value)) {
    const compacted = value
      .slice(0, arrayLimit)
      .map((item) => compactForPrompt(item, options, depth + 1));
    if (value.length > arrayLimit) {
      compacted.push(`+${value.length - arrayLimit} more`);
    }
    return compacted;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, objectKeyLimit)) {
      result[key] = compactForPrompt(entry, options, depth + 1);
    }
    const remaining = entries.length - objectKeyLimit;
    if (remaining > 0) result._more_keys = remaining;
    return result;
  }
  return String(value);
}

function safeStringify(value: unknown, maxLength = 2000): string {
  try {
    const json = JSON.stringify(value);
    if (!json) return "<empty>";
    if (json.length <= maxLength) return json;
    return `${json.slice(0, maxLength)}...<truncated>`;
  } catch {
    return "<unserializable>";
  }
}

/** Render a primitive cell for human-readable row/key lines. */
function renderPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return `[${value.join(", ")}]`;
    }
    return safeStringify(value, 200);
  }
  if (isObject(value)) {
    // Compact key: value form for small objects (e.g. available_actions).
    const entries = Object.entries(value)
      .slice(0, 4)
      .map(([k, v]) => `${k}=${renderPrimitive(v)}`);
    return `{${entries.join(", ")}${Object.keys(value).length > 4 ? ", ..." : ""}}`;
  }
  return String(value);
}

function findReadable(readables: Readable[], id: string): unknown {
  return readables.find((r) => r.id === id)?.value;
}

function findFormReadables(readables: Readable[]): unknown[] {
  return readables
    .filter((r) => !isSystemReadable(r))
    .map((r) => r.value)
    .filter((v) => isObject(v));
}

function findListReadables(readables: Readable[]): Readable[] {
  return readables.filter((readable) => {
    if (isSystemReadable(readable)) return false;
    if (!isObject(readable.value)) return false;
    return Array.isArray(readable.value.visible_rows);
  });
}

function findDetailReadables(readables: Readable[]): Readable[] {
  return readables.filter((readable) => {
    if (isSystemReadable(readable)) return false;
    if (!isObject(readable.value)) return false;
    return readable.value.page_kind === "detail";
  });
}

function isActiveFormReadable(value: unknown): boolean {
  return isObject(value) && isObject(value.activeForm);
}

function findSupportingReadables(readables: Readable[]): Readable[] {
  return readables.filter((readable) => {
    if (isSystemReadable(readable)) return false;
    if (!isObject(readable.value)) return false;
    if (readable.value.page_kind === "detail") return false;
    if (Array.isArray(readable.value.visible_rows)) return false;
    if (isActiveFormReadable(readable.value)) return false;
    return true;
  });
}

function getCurrentPath(runtime: unknown): string | null {
  if (!isObject(runtime)) return null;
  const route = isObject(runtime.route) ? runtime.route : {};
  return typeof route.pathname === "string" ? route.pathname : null;
}

function readableRoute(readable: Readable): string | null {
  if (!isObject(readable.value)) return null;
  return typeof readable.value.route === "string" ? readable.value.route : null;
}

function preferCurrentRouteReadables(
  readables: Readable[],
  currentPath: string | null,
): Readable[] {
  if (!currentPath) return readables;
  const exact = readables.filter((readable) => readableRoute(readable) === currentPath);
  return exact.length > 0 ? exact : readables;
}

function filterReadablesForCurrentRoute(
  readables: Readable[],
  currentPath: string | null,
): Readable[] {
  if (!currentPath) return readables;
  return readables.filter((readable) => {
    if (isSystemReadable(readable)) return true;
    return readableRoute(readable) === currentPath;
  });
}

/**
 * Build a key=value summary for a visible list row.
 * Replaces the old raw-JSON dump format with a readable line.
 */
function renderRowSummary(row: unknown): string {
  if (!isObject(row)) return renderPrimitive(row);

  const preferredKeys = [
    "row_number",
    "id",
    "name",
    "code",
    "contract_no",
    "indent_no",
    "contractor_name",
    "department_name",
    "stage",
    "status",
    "date_of_inspection",
    "category_type",
    "tracking_type",
    "location_type",
    "is_store",
    "is_active",
    "detail_route",
    "workflow",
    "available_actions",
  ];

  const parts: string[] = [];
  const used = new Set<string>();
  for (const key of preferredKeys) {
    if (key in row) {
      parts.push(`${key}=${renderPrimitive(row[key])}`);
      used.add(key);
    }
  }

  if (parts.length === 0) {
    for (const [key, value] of Object.entries(row).slice(0, 12)) {
      parts.push(`${key}=${renderPrimitive(value)}`);
      used.add(key);
    }
  }

  return parts.join(", ");
}

function formatListReadables(readables: Readable[], currentPath: string | null): string[] {
  const listReadables = findListReadables(readables);
  if (listReadables.length === 0) return [];

  const chosen = preferCurrentRouteReadables(listReadables, currentPath);

  const lines: string[] = ["", "## VISIBLE PAGE ROWS"];
  lines.push(
    "Use these rows to resolve references like \"this one\", \"the first one\", \"the second row\", or visible names/codes.",
  );

  for (const readable of chosen.slice(0, 3)) {
    const value = readable.value as Record<string, unknown>;
    const route = typeof value.route === "string" ? value.route : "unknown route";
    const visibleRows = Array.isArray(value.visible_rows) ? value.visible_rows : [];
    const total =
      typeof value.filtered_total === "number"
        ? value.filtered_total
        : typeof value.total === "number"
          ? value.total
          : visibleRows.length;
    const pagination = isObject(value.pagination) ? value.pagination : null;
    const page = pagination?.page ? ` page ${String(pagination.page)}` : "";

    lines.push("");
    lines.push(`<visible_list route="${route}" visible_rows="${visibleRows.length}" filtered_total="${total}"${page ? ` pagination="page ${String(pagination?.page)}"` : ""}>`);
    lines.push(`  description: ${readable.description}`);
    lines.push(`  route: ${route}; visible rows: ${visibleRows.length}; filtered total: ${total}${page}`);

    visibleRows.slice(0, 12).forEach((row, index) => {
      lines.push(`  ${index + 1}. ${renderRowSummary(row)}`);
    });

    if (visibleRows.length > 12) {
      lines.push(`  ... ${visibleRows.length - 12} more visible rows not shown`);
    }
    lines.push(`</visible_list>`);
  }

  return lines;
}

function formatDetailReadables(readables: Readable[], currentPath: string | null): string[] {
  const detailReadables = findDetailReadables(readables);
  if (detailReadables.length === 0) return [];

  const chosen = preferCurrentRouteReadables(detailReadables, currentPath);
  const lines: string[] = ["", "## DETAIL PAGE CONTEXT"];
  lines.push(
    "Use this detail context as the primary source for questions about the current record, its related rows, workflow, documents, distribution, or page-specific summary.",
  );

  for (const readable of chosen.slice(0, 3)) {
    const value = isObject(readable.value) ? readable.value : {};
    const route = readableRoute(readable) ?? "unknown route";
    const entity = typeof value.entity === "string" ? value.entity : "unknown entity";
    lines.push("");
    lines.push(`<detail_page route="${route}" entity="${entity}">`);
    lines.push(`  description: ${readable.description}`);
    lines.push(`  route: ${route}; entity: ${entity}`);
    lines.push(
      `  context: ${safeStringify(
        compactForPrompt(value, {
          arrayLimit: 20,
          objectKeyLimit: 28,
          maxDepth: 5,
        }),
        3500,
      )}`,
    );
    lines.push(`</detail_page>`);
  }

  return lines;
}

function formatSupportingReadables(readables: Readable[], currentPath: string | null): string[] {
  const supportingReadables = findSupportingReadables(readables);
  if (supportingReadables.length === 0) return [];

  const chosen = preferCurrentRouteReadables(supportingReadables, currentPath);
  const lines: string[] = ["", "## SUPPORTING PAGE CONTEXT"];
  lines.push(
    "Use these route-scoped catalogs, option lists, summaries, and helper context when resolving IDs or explaining the current page.",
  );

  for (const readable of chosen.slice(0, 3)) {
    const route = readableRoute(readable) ?? "unknown route";
    lines.push("");
    lines.push(`<supporting_context route="${route}">`);
    lines.push(`  description: ${readable.description}`);
    lines.push(`  route: ${route}`);
    lines.push(
      `  context: ${safeStringify(
        compactForPrompt(readable.value, {
          arrayLimit: 12,
          objectKeyLimit: 20,
          maxDepth: 4,
        }),
        2500,
      )}`,
    );
    lines.push(`</supporting_context>`);
  }

  return lines;
}

function describeChange(change: unknown): string | null {
  if (!isObject(change)) return null;
  const fields = Array.isArray(change.fields) ? change.fields : [];
  const at = typeof change.changedAt === "string" ? change.changedAt : "";

  if (change.field && "previousValue" in change && "currentValue" in change) {
    return `${change.field}: "${safeStringify(change.previousValue, 100)}" → "${safeStringify(change.currentValue, 100)}" (at ${at})`;
  }

  if (fields.length > 0) {
    const prev = isObject(change.previousValues) ? change.previousValues : {};
    const curr = isObject(change.currentValues) ? change.currentValues : {};
    const lines = fields
      .map(
        (f: string) =>
          `      • ${f}: "${safeStringify(prev[f], 100)}" → "${safeStringify(curr[f], 100)}"`,
      )
      .join("\n");
    return `${fields.length} fields changed at ${at}:\n${lines}`;
  }

  return null;
}

function formatFieldOption(option: unknown): string {
  if (!isObject(option)) return safeStringify(option, 120);
  const label = option.label ?? option.name ?? option.register_number ?? option.code ?? option.value;
  const value = option.value ?? option.id;
  return `${String(label)}=${String(value)}`;
}

function appendOptionFieldMetadata(parts: string[], field: Record<string, unknown>) {
  if (typeof field.optionsState === "string") {
    parts.push(`optionsState=${field.optionsState}`);
  }
  if (typeof field.optionSource === "string") {
    parts.push(`optionSource=${field.optionSource}`);
  }
  if (typeof field.resolver === "string") {
    parts.push(`resolver=${field.resolver}`);
  }
  if (Array.isArray(field.dependsOn) && field.dependsOn.length > 0) {
    parts.push(`dependsOn=[${field.dependsOn.map(String).join(", ")}]`);
  }
  if (Array.isArray(field.affects) && field.affects.length > 0) {
    parts.push(`affects=[${field.affects.map(String).join(", ")}]`);
  }
  if (Array.isArray(field.missingDependencies) && field.missingDependencies.length > 0) {
    parts.push(`missingDependencies=[${field.missingDependencies.map(String).join(", ")}]`);
  }
  if (typeof field.totalCount === "number") {
    parts.push(`totalCount=${field.totalCount}`);
  }
  if (typeof field.hasMore === "boolean") {
    parts.push(`hasMore=${field.hasMore}`);
  }

  if (Array.isArray(field.options)) {
    const options = field.options.slice(0, 8).map(formatFieldOption);
    parts.push(`options=[${options.join(", ")}${field.options.length > 8 ? ", ..." : ""}]`);
  }
  if (Array.isArray(field.optionsPreview)) {
    const options = field.optionsPreview.slice(0, 8).map(formatFieldOption);
    parts.push(`optionsPreview=[${options.join(", ")}${field.optionsPreview.length > 8 ? ", ..." : ""}]`);
  }
}

function formatArrayItemField(itemField: unknown): string | null {
  if (!isObject(itemField) || typeof itemField.name !== "string") return null;
  if (hasPendingDependencies(itemField)) return null;
  const parts = [itemField.name];
  if (typeof itemField.type === "string") parts.push(`type=${itemField.type}`);
  if (typeof itemField.label === "string") parts.push(`label="${itemField.label}"`);
  if (itemField.required === true) parts.push("required=true");
  if (itemField.readOnly === true) parts.push("readOnly=true");
  appendOptionFieldMetadata(parts, itemField);
  return `${itemField.name}(${parts.slice(1).join(", ")})`;
}

function formatDeferredArrayItemFields(fields: unknown[]): string | null {
  const deferred: string[] = [];
  for (const f of fields) {
    if (!isObject(f) || typeof f.name !== "string") continue;
    if (!hasPendingDependencies(f)) continue;
    const deps = (f.missingDependencies as unknown[]).map(String).join(", ");
    deferred.push(`${f.name} (needs ${deps})`);
  }
  if (deferred.length === 0) return null;
  return `deferredFields=[${deferred.join(", ")}]`;
}

function formatField(field: unknown): string | null {
  if (!isObject(field)) return null;
  const name = typeof field.name === "string" ? field.name : null;
  if (!name) return null;
  if (hasPendingDependencies(field)) return null;

  const parts = [name];
  if (typeof field.type === "string") parts.push(`type=${field.type}`);
  if (typeof field.label === "string") parts.push(`label="${field.label}"`);
  if (field.required === true) parts.push("required=true");
  if (field.readOnly === true) parts.push("readOnly=true");
  appendOptionFieldMetadata(parts, field);

  if (Array.isArray(field.arrayItemFields) && field.arrayItemFields.length > 0) {
    const visibleCount = field.arrayItemFields.length;
    const itemFields = field.arrayItemFields
      .map(formatArrayItemField)
      .filter((itemField): itemField is string => Boolean(itemField))
      .slice(0, 24);
    if (itemFields.length > 0) {
      parts.push(`arrayItemFields=[${itemFields.join(", ")}${visibleCount > 24 ? ", ..." : ""}]`);
    }
    const deferred = formatDeferredArrayItemFields(field.arrayItemFields);
    if (deferred) {
      parts.push(deferred);
    }
  }

  return parts.join("; ");
}

function formatRuntime(runtime: unknown): string[] {
  if (!isObject(runtime)) return [];
  const lines: string[] = ["## LIVE PAGE"];
  const route = isObject(runtime.route) ? runtime.route : {};
  if (route.pathname) lines.push(`- Current route: ${String(route.pathname)}`);
  if (route.observed_at) lines.push(`- Observed at: ${String(route.observed_at)}`);

  const user = isObject(runtime.user) ? runtime.user : null;
  if (user) {
    lines.push(
      `- Signed-in user: ${String(user.username ?? "?")} (id=${String(user.id ?? "?")}${user.is_superuser ? ", superuser" : ""})`,
    );
    if (Array.isArray(user.assigned_locations) && user.assigned_locations.length > 0) {
      lines.push(`- Assigned locations: ${user.assigned_locations.length}`);
    }
  }
  return lines;
}

function formatDeferredFieldsSummary(fields: unknown[]): string | null {
  const deferred: string[] = [];
  for (const f of fields) {
    if (!isObject(f) || typeof f.name !== "string") continue;
    if (!hasPendingDependencies(f)) continue;
    const deps = (f.missingDependencies as unknown[]).map(String).join(", ");
    deferred.push(`${f.name} (needs ${deps})`);
  }
  if (deferred.length === 0) return null;
  return `Deferred fields (hidden — fill their dependencies first, they appear on the next turn): ${deferred.join("; ")}`;
}

function formatActiveForm(formReadables: unknown[]): string[] {
  const lines: string[] = [];

  for (const readable of formReadables) {
    if (!isObject(readable)) continue;
    const activeForm = isObject(readable.activeForm) ? readable.activeForm : null;
    if (!activeForm) continue;

    const title = String(activeForm.title ?? activeForm.formId);
    const formId = String(activeForm.formId);
    const mode = activeForm.mode ? String(activeForm.mode) : "";

    lines.push("");
    lines.push(`## ACTIVE FORM: ${title}`);
    lines.push(`<active_form form_id="${formId}" title="${title}"${mode ? ` mode="${mode}"` : ""}>`);
    lines.push(`- formId: ${formId}`);
    if (mode) lines.push(`- mode: ${mode}`);

    const workflowGuidance = typeof activeForm.formId === "string"
      ? getFormWorkflowGuidance(activeForm.formId)
      : null;
    if (workflowGuidance) {
      lines.push("");
      lines.push("<workflow_guidance>");
      lines.push(workflowGuidance);
      lines.push("</workflow_guidance>");
      lines.push("");
    }
    if (Array.isArray(activeForm.fields) && activeForm.fields.length > 0) {
      lines.push("<writable_fields>");
      lines.push("Writable field schema (ONLY these exact names are fillable with set_form_values):");
      activeForm.fields
        .map(formatField)
        .filter((field): field is string => Boolean(field))
        .slice(0, 40)
        .forEach((field) => lines.push(`  - ${field}`));
      if (activeForm.fields.length > 40) {
        lines.push(`  - ... ${activeForm.fields.length - 40} more writable fields not shown`);
      }
      const deferredSummary = formatDeferredFieldsSummary(activeForm.fields as unknown[]);
      if (deferredSummary) {
        lines.push(`  ${deferredSummary}`);
      }
      lines.push("</writable_fields>");
    } else {
      lines.push("- Writable field schema: none currently exposed.");
    }

    if (isObject(activeForm.setValuesSchema)) {
      lines.push(
        `- set_form_values.values JSON schema: ${safeStringify(
          compactForPrompt(activeForm.setValuesSchema, {
            arrayLimit: 24,
            objectKeyLimit: 48,
            maxDepth: 8,
          }),
          4000,
        )}`,
      );
    }

    if (isObject(activeForm.values)) {
      lines.push(
        `- Current values/context snapshot (not all keys are writable; use the writable field schema above): ${safeStringify(activeForm.values, 1500)}`,
      );
    }

    if (Array.isArray(activeForm.dirtyFields) && activeForm.dirtyFields.length > 0) {
      lines.push(`- Dirty (changed from initial): ${activeForm.dirtyFields.join(", ")}`);
    }

    if (isObject(activeForm.errors) && Object.keys(activeForm.errors).length > 0) {
      lines.push(`- Validation errors: ${safeStringify(activeForm.errors, 600)}`);
    }

    const userEdit = describeChange(activeForm.lastUserEdit);
    const assistantEdit = describeChange(activeForm.lastAssistantEdit);

    if (userEdit) {
      lines.push("");
      lines.push("<user_manual_override>");
      lines.push("⚠️ USER MANUAL OVERRIDE — TRUST THIS, NOT YOUR MEMORY:");
      lines.push(`  ${userEdit}`);
      lines.push(
        "  The user edited the above AFTER any value you may have set. The 'Current values' above are the truth. Do not reference older values from earlier in this conversation.",
      );
      lines.push("</user_manual_override>");
    }

    if (assistantEdit) {
      lines.push("");
      lines.push(`(For reference, your last patch to this form was: ${assistantEdit})`);
    }

    if (isObject(activeForm.allowedActions)) {
      const allowed = Object.entries(activeForm.allowedActions)
        .filter(([k, v]) => v === true && !AGENT_HIDDEN_FRONTEND_ACTIONS.has(k))
        .map(([k]) => k);
      if (allowed.length > 0) {
        lines.push(`- Allowed form actions: ${allowed.join(", ")}`);
      }
    }

    lines.push(`</active_form>`);
  }

  return lines;
}

function formatActivity(activity: unknown): string[] {
  if (!isObject(activity)) return [];
  const lines: string[] = ["", "## RECENT ACTIVITY", "<recent_activity>"];

  const currentPage = isObject(activity.currentPage) ? activity.currentPage : null;
  if (currentPage?.pathname) {
    lines.push(`- Page (from activity log): ${String(currentPage.pathname)}`);
  }

  const lastSubmit = isObject(activity.lastSubmitResult) ? activity.lastSubmitResult : null;
  if (lastSubmit) {
    const ok = lastSubmit.ok;
    const msg = typeof lastSubmit.message === "string" ? lastSubmit.message : "";
    const result = isObject(lastSubmit.result) ? lastSubmit.result : null;
    const recordId =
      typeof result?.recordId === "string" || typeof result?.recordId === "number"
        ? String(result.recordId)
        : undefined;
    const redirectTo =
      typeof result?.redirectTo === "string" && result.redirectTo
        ? result.redirectTo
        : undefined;
    const continuation = [
      recordId ? `recordId=${recordId}` : undefined,
      redirectTo ? `redirectTo=${redirectTo}` : undefined,
    ].filter(Boolean);
    lines.push(
      `- Last submit: ${ok === true ? "✅ OK" : ok === false ? "❌ FAILED" : "unverified"} on form ${String(lastSubmit.formTitle ?? lastSubmit.formId ?? "?")}${msg ? ` — ${msg}` : ""}`,
    );
    if (continuation.length > 0) {
      lines.push(`- Last submit result details: ${continuation.join(", ")}`);
    }
  }

  const lastClosed = isObject(activity.lastClosedForm) ? activity.lastClosedForm : null;
  if (lastClosed) {
    const label = String(lastClosed.title ?? lastClosed.formId ?? "unknown form");
    const route = typeof lastClosed.route === "string" ? lastClosed.route : "";
    lines.push(`- Last closed form: ${label}${route ? ` on ${route}` : ""}`);
  }

  const recent = Array.isArray(activity.recentActivity) ? activity.recentActivity : [];
  if (recent.length > 0) {
    lines.push(`- Last ${recent.length} events (oldest → newest):`);
    for (const ev of recent.slice(-15)) {
      if (!isObject(ev)) continue;
      const at = typeof ev.at === "string" ? ev.at.slice(11, 19) : "";
      const actor = typeof ev.actor === "string" ? ev.actor : "?";
      const title = typeof ev.title === "string" ? ev.title : String(ev.kind ?? "?");
      lines.push(`    • [${at}] ${actor}: ${title}`);
    }
  }

  lines.push("</recent_activity>");
  return lines;
}

function formatPermissions(perms: unknown, actions: ActionDef[]): string[] {
  if (!isObject(perms)) return [];
  const lines: string[] = ["", "## PERMISSIONS", "<permissions>"];

  const user = isObject(perms.user) ? perms.user : null;
  if (user?.is_superuser) {
    lines.push("- Signed-in user is SUPERUSER (all capabilities granted).");
  }

  const capabilities = isObject(perms.capabilities) ? perms.capabilities : null;
  if (capabilities) {
    const canManage = Array.isArray(capabilities.canManage) ? capabilities.canManage : [];
    const canFull = Array.isArray(capabilities.canFull) ? capabilities.canFull : [];
    const cannotManage = Array.isArray(capabilities.cannotManage) ? capabilities.cannotManage : [];

    if (canManage.length > 0) lines.push(`- Can MANAGE: ${canManage.join(", ")}`);
    if (canFull.length > 0) lines.push(`- Can FULL: ${canFull.join(", ")}`);
    if (cannotManage.length > 0) {
      lines.push(`- CANNOT manage (do NOT try write actions here): ${cannotManage.join(", ")}`);
    }
  }

  const agentActions = actions.filter(
    (a) => !AGENT_HIDDEN_FRONTEND_ACTIONS.has(a.name),
  );
  const allowedActions = agentActions.filter((a) => a.allowed !== false);
  const blockedActions = agentActions.filter((a) => a.allowed === false);

  if (allowedActions.length > 0) {
    lines.push("");
    lines.push("✅ ALLOWED frontend actions (only these can be called):");
    for (const a of allowedActions) {
      lines.push(`    • ${a.name} — ${a.description}`);
    }
  }

  if (blockedActions.length > 0) {
    lines.push("");
    lines.push("❌ BLOCKED frontend actions (DO NOT call these — explain the block to the user):");
    for (const a of blockedActions) {
      const reason = a.blockedReason ? ` [${a.blockedReason}]` : "";
      lines.push(`    • ${a.name}${reason}`);
    }
  }

  lines.push("</permissions>");
  return lines;
}

export function formatPageContextForPrompt(ctx: PageContext | undefined): string {
  if (!ctx) return "";

  // PageContext arrives from the host app with all fields optional. Normalize
  // it once here into the strict Readable/ActionDef shapes the formatters use.
  const readables: Readable[] = (
    Array.isArray(ctx.readables) ? ctx.readables : []
  ).map((readable) => ({
    id: typeof readable.id === "string" ? readable.id : "",
    description:
      typeof readable.description === "string" ? readable.description : "",
    value: readable.value,
  }));
  const actions: ActionDef[] = (
    Array.isArray(ctx.actions) ? ctx.actions : []
  ).map((action) => ({
    ...action,
    name: typeof action.name === "string" ? action.name : "",
    description:
      typeof action.description === "string" ? action.description : "",
    parameters:
      action.parameters && typeof action.parameters === "object"
        ? action.parameters
        : {},
  }));

  if (readables.length === 0 && actions.length === 0) {
    return "\n\nCurrent page context: no page state shared by the host app.";
  }

  const header = [
    "",
    "",
    "<live_page_state>",
    "This block reflects the user's browser RIGHT NOW. It is the authoritative source of truth.",
    "If anything here contradicts something you said earlier in this chat, TRUST THIS, not your memory.",
    "If you set a field and the user changed it, the user's value wins — never re-assert your old value.",
    "",
  ];

  const runtime = findReadable(readables, RUNTIME_READABLE_ID);
  const activity = findReadable(readables, ACTIVITY_READABLE_ID);
  const permission = findReadable(readables, PERMISSION_READABLE_ID);
  const currentPath = getCurrentPath(runtime);
  const routeReadables = filterReadablesForCurrentRoute(readables, currentPath);
  const formReadables = findFormReadables(routeReadables);

  const body: string[] = [];
  body.push(...formatRuntime(runtime));
  body.push(...formatDetailReadables(routeReadables, currentPath));
  body.push(...formatListReadables(routeReadables, currentPath));
  body.push(...formatSupportingReadables(routeReadables, currentPath));
  body.push(...formatActiveForm(formReadables));
  body.push(...formatActivity(activity));
  body.push(...formatPermissions(permission, actions));

  const footer = [
    "",
    "</live_page_state>",
  ];

  return [...header, ...body, ...footer].join("\n");
}

/**
 * Reads pageContext from runtime.configurable (set per-turn by the frontend)
 * and appends a structured "LIVE PAGE STATE" block to the system prompt.
 * The user never sees this — it only goes to the LLM.
 *
 * The block is formatted with XML-style tags so the LLM can distinguish
 * route info, active form schema, visible rows, detail context, recent
 * activity, and permissions cleanly. Inside each tag the layout is
 * human-readable key:value lines instead of raw JSON dumps.
 */
export const pageContextMiddleware = dynamicSystemPromptMiddleware(
  (_state, runtime) => {
    const configurable = runtime.configurable as
      | { pageContext?: PageContext }
      | undefined;
    return formatPageContextForPrompt(configurable?.pageContext);
  },
);
