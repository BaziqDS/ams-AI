import {
  buildFrontendActionResume,
  type FrontendActionInterrupt,
} from "./frontend-action-interrupt";

type FrontendActionStatus = "running" | "resuming" | "completed" | "failed";

type FrontendActionSubmit = (
  values: Record<string, never>,
  options: {
    command: {
      resume: ReturnType<typeof buildFrontendActionResume>;
    };
    config: {
      configurable: {
        pageContext: unknown;
      };
    };
    streamMode: ["values", "custom"];
  },
) => void;

export type FrontendActionRunnerDeps = {
  callAction: (name: string, args: unknown) => Promise<unknown>;
  getFreshContext: () => Promise<unknown>;
  submit: FrontendActionSubmit;
  isMounted?: () => boolean;
  onStatus?: (status: FrontendActionStatus, message: string) => void;
};

const CONTEXT_READY_ATTEMPTS = 12;
const CONTEXT_READY_RETRY_DELAY_MS = 250;

function contextFingerprint(context: unknown) {
  try {
    return JSON.stringify(context);
  } catch {
    return String(context);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readActionArgs(args: unknown) {
  return isRecord(args) ? args : {};
}

function readRoute(context: unknown) {
  if (!isRecord(context) || !Array.isArray(context.readables)) return null;
  const runtime = context.readables.find((readable) => {
    return (
      isRecord(readable) &&
      readable.id === "__ams_runtime_context" &&
      isRecord(readable.value)
    );
  });
  if (!isRecord(runtime) || !isRecord(runtime.value)) return null;
  const route = runtime.value.route ?? runtime.value.pathname ?? runtime.value.path;
  return typeof route === "string" ? route : null;
}

function hasVisibleRows(context: unknown) {
  if (!isRecord(context) || !Array.isArray(context.readables)) return false;
  return context.readables.some((readable) => {
    return (
      isRecord(readable) &&
      isRecord(readable.value) &&
      Array.isArray(readable.value.visible_rows)
    );
  });
}

function hasActiveForm(context: unknown, formId?: string) {
  if (!isRecord(context) || !Array.isArray(context.readables)) return false;
  return context.readables.some((readable) => {
    if (!isRecord(readable) || !isRecord(readable.value)) return false;
    const value = readable.value;
    const candidateFormId = value.formId ?? value.form_id;
    if (formId && candidateFormId !== formId) return false;
    return Array.isArray(value.fields) && value.fields.length > 0;
  });
}

function isListingRoute(path: string) {
  return [
    "/categories",
    "/inspections",
    "/items",
    "/locations",
    "/stock-entries",
    "/stock-registers",
    "/users",
    "/roles",
    "/maintenance",
    "/depreciation",
  ].includes(path.replace(/\/$/, ""));
}

function contextIsReadyForAction(
  action: FrontendActionInterrupt["action"],
  context: unknown,
) {
  const args = readActionArgs(action.args);

  if (action.name === "open_form") {
    const formId = args.form_id ?? args.formId;
    return typeof formId === "string"
      ? hasActiveForm(context, formId)
      : hasActiveForm(context);
  }

  if (action.name.startsWith("open_create_") && action.name.endsWith("_form")) {
    return hasActiveForm(context);
  }

  if (action.name === "navigate_to_route") {
    const target = args.path ?? args.route;
    if (typeof target !== "string") return true;
    const route = readRoute(context);
    if (route !== target) return false;
    if (isListingRoute(target)) return hasVisibleRows(context);
    return true;
  }

  return true;
}

function actionRequiresReadyContext(action: FrontendActionInterrupt["action"]) {
  return (
    action.name === "navigate_to_route" ||
    action.name === "open_form" ||
    (action.name.startsWith("open_create_") && action.name.endsWith("_form"))
  );
}

function readinessDescription(action: FrontendActionInterrupt["action"]) {
  const args = readActionArgs(action.args);

  if (action.name === "open_form") {
    const formId = args.form_id ?? args.formId;
    return typeof formId === "string"
      ? `active form "${formId}" with writable fields`
      : "an active form with writable fields";
  }

  if (action.name.startsWith("open_create_") && action.name.endsWith("_form")) {
    return "an active create form with writable fields";
  }

  if (action.name === "navigate_to_route") {
    const target = args.path ?? args.route;
    if (typeof target === "string" && isListingRoute(target)) {
      return `route "${target}" with visible_rows`;
    }
    if (typeof target === "string") return `route "${target}"`;
  }

  return "fresh page context";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFreshActionContext(
  deps: FrontendActionRunnerDeps,
  action: FrontendActionInterrupt["action"],
  beforeContext: unknown,
) {
  const before = contextFingerprint(beforeContext);
  let latest = beforeContext;
  const requiresReadyContext = actionRequiresReadyContext(action);

  for (let attempt = 0; attempt < CONTEXT_READY_ATTEMPTS; attempt += 1) {
    latest = await deps.getFreshContext();
    if (!requiresReadyContext) return latest;
    if (
      contextFingerprint(latest) !== before &&
      contextIsReadyForAction(action, latest)
    ) {
      return latest;
    }
    await delay(CONTEXT_READY_RETRY_DELAY_MS);
  }

  if (requiresReadyContext) {
    throw new Error(
      `Page context was not ready after frontend action "${action.name}". ` +
        `Expected ${readinessDescription(action)} before resuming the agent.`,
    );
  }

  return latest;
}

function notify(
  deps: FrontendActionRunnerDeps,
  status: FrontendActionStatus,
  message: string,
) {
  if (deps.isMounted?.() === false) return;
  deps.onStatus?.(status, message);
}

export async function runFrontendActionInterrupt(
  interrupt: FrontendActionInterrupt,
  deps: FrontendActionRunnerDeps,
) {
  try {
    notify(deps, "running", "Running browser action...");
    const beforeContext = await deps.getFreshContext();
    const result = await deps.callAction(
      interrupt.action.name,
      interrupt.action.args,
    );
    notify(
      deps,
      "resuming",
      "Browser action finished. Refreshing page context before the agent continues...",
    );
    const pageContext = await waitForFreshActionContext(
      deps,
      interrupt.action,
      beforeContext,
    );
    deps.submit(
      {},
      {
        command: {
          resume: buildFrontendActionResume(interrupt, result),
        },
        config: {
          configurable: {
            pageContext,
          },
        },
        streamMode: ["values", "custom"],
      },
    );
    notify(deps, "completed", "Browser action result returned to the agent.");
  } catch (error) {
    notify(
      deps,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
    const pageContext = await deps.getFreshContext();
    deps.submit(
      {},
      {
        command: {
          resume: buildFrontendActionResume(interrupt, undefined, error),
        },
        config: {
          configurable: {
            pageContext,
          },
        },
        streamMode: ["values", "custom"],
      },
    );
  }
}
