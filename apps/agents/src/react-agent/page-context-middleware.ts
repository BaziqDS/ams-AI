import { dynamicSystemPromptMiddleware } from "langchain";

type Readable = { id: string; description: string; value: unknown };
type ActionDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  allowed?: boolean;
  blockedReason?: string;
  requiredPermissions?: string[];
  requiredCapabilities?: Array<{ module: string; level?: string }>;
};
type PageContext = { readables?: Readable[]; actions?: ActionDef[] };

const RUNTIME_READABLE_ID = "__ams_runtime_context";
const ACTIVITY_READABLE_ID = "__ams_activity_context";
const PERMISSION_READABLE_ID = "__ams_permission_context";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function findReadable(readables: Readable[], id: string): unknown {
  return readables.find((r) => r.id === id)?.value;
}

function findFormReadables(readables: Readable[]): unknown[] {
  return readables
    .filter(
      (r) =>
        r.id !== RUNTIME_READABLE_ID &&
        r.id !== ACTIVITY_READABLE_ID &&
        r.id !== PERMISSION_READABLE_ID,
    )
    .map((r) => r.value)
    .filter((v) => isObject(v));
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
          `    • ${f}: "${safeStringify(prev[f], 100)}" → "${safeStringify(curr[f], 100)}"`,
      )
      .join("\n");
    return `${fields.length} fields changed at ${at}:\n${lines}`;
  }

  return null;
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

function formatActiveForm(formReadables: unknown[]): string[] {
  const lines: string[] = [];

  for (const readable of formReadables) {
    if (!isObject(readable)) continue;
    const activeForm = isObject(readable.activeForm) ? readable.activeForm : null;
    if (!activeForm) continue;

    lines.push("");
    lines.push(`## ACTIVE FORM: ${String(activeForm.title ?? activeForm.formId)}`);
    lines.push(`- formId: ${String(activeForm.formId)}`);
    if (activeForm.mode) lines.push(`- mode: ${String(activeForm.mode)}`);

    if (isObject(activeForm.values)) {
      lines.push(`- Current values: ${safeStringify(activeForm.values, 1500)}`);
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
      lines.push("⚠️ USER MANUAL OVERRIDE — TRUST THIS, NOT YOUR MEMORY:");
      lines.push(`   ${userEdit}`);
      lines.push(
        "   The user edited the above AFTER any value you may have set. The 'Current values' above are the truth. Do not reference older values from earlier in this conversation.",
      );
    }

    if (assistantEdit) {
      lines.push("");
      lines.push(`(For reference, your last patch to this form was: ${assistantEdit})`);
    }

    if (isObject(activeForm.allowedActions)) {
      const allowed = Object.entries(activeForm.allowedActions)
        .filter(([, v]) => v === true)
        .map(([k]) => k);
      if (allowed.length > 0) {
        lines.push(`- Allowed form actions: ${allowed.join(", ")}`);
      }
    }
  }

  return lines;
}

function formatActivity(activity: unknown): string[] {
  if (!isObject(activity)) return [];
  const lines: string[] = ["", "## RECENT ACTIVITY"];

  const currentPage = isObject(activity.currentPage) ? activity.currentPage : null;
  if (currentPage?.pathname) {
    lines.push(`- Page (from activity log): ${String(currentPage.pathname)}`);
  }

  const lastSubmit = isObject(activity.lastSubmitResult) ? activity.lastSubmitResult : null;
  if (lastSubmit) {
    const ok = lastSubmit.ok;
    const msg = typeof lastSubmit.message === "string" ? lastSubmit.message : "";
    lines.push(
      `- Last submit: ${ok === true ? "✅ OK" : ok === false ? "❌ FAILED" : "unverified"} on form ${String(lastSubmit.formTitle ?? lastSubmit.formId ?? "?")}${msg ? ` — ${msg}` : ""}`,
    );
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

  return lines;
}

function formatPermissions(perms: unknown, actions: ActionDef[]): string[] {
  if (!isObject(perms)) return [];
  const lines: string[] = ["", "## PERMISSIONS"];

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

  const allowedActions = actions.filter((a) => a.allowed !== false);
  const blockedActions = actions.filter((a) => a.allowed === false);

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

  return lines;
}

function formatPageContext(ctx: PageContext | undefined): string {
  if (!ctx) return "";
  const readables = Array.isArray(ctx.readables) ? ctx.readables : [];
  const actions = Array.isArray(ctx.actions) ? ctx.actions : [];

  if (readables.length === 0 && actions.length === 0) {
    return "\n\nCurrent page context: no page state shared by the host app.";
  }

  const header = [
    "",
    "",
    "==================== LIVE PAGE STATE ====================",
    "This section reflects the user's browser RIGHT NOW. It is the authoritative source of truth.",
    "If anything here contradicts something you said earlier in this chat, TRUST THIS, not your memory.",
    "If you set a field and the user changed it, the user's value wins — never re-assert your old value.",
    "",
  ];

  const runtime = findReadable(readables, RUNTIME_READABLE_ID);
  const activity = findReadable(readables, ACTIVITY_READABLE_ID);
  const permission = findReadable(readables, PERMISSION_READABLE_ID);
  const formReadables = findFormReadables(readables);

  const body: string[] = [];
  body.push(...formatRuntime(runtime));
  body.push(...formatActiveForm(formReadables));
  body.push(...formatActivity(activity));
  body.push(...formatPermissions(permission, actions));

  const footer = [
    "",
    "==================== END LIVE PAGE STATE ====================",
  ];

  return [...header, ...body, ...footer].join("\n");
}

/**
 * Reads pageContext from runtime.configurable (set per-turn by the frontend)
 * and appends a structured "LIVE PAGE STATE" block to the system prompt.
 * The user never sees this — it only goes to the LLM.
 *
 * The block is formatted to surface user manual overrides, allowed/blocked
 * actions, and recent activity so the LLM cannot drift toward stale memory.
 */
export const pageContextMiddleware = dynamicSystemPromptMiddleware(
  (_state, runtime) => {
    const configurable = runtime.configurable as
      | { pageContext?: PageContext }
      | undefined;
    return formatPageContext(configurable?.pageContext);
  },
);
