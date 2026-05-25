import {
  buildFrontendActionResume,
  type FrontendActionInterrupt,
} from "./frontend-action-interrupt";
import { buildAgentRunConfig } from "./agent-run-config";

type FrontendActionStatus = "running" | "resuming" | "completed" | "failed";

type PageContextLike = {
  readables?: unknown;
};

type FrontendActionSubmit = (
  values: Record<string, never>,
  options: {
    command: {
      resume: ReturnType<typeof buildFrontendActionResume>;
    };
    config: ReturnType<typeof buildAgentRunConfig>;
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

function notify(
  deps: FrontendActionRunnerDeps,
  status: FrontendActionStatus,
  message: string,
) {
  if (deps.isMounted?.() === false) return;
  deps.onStatus?.(status, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRoute(path: string) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function stringArg(args: unknown, keys: string[]) {
  if (!isObject(args)) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function getCurrentRoute(pageContext: unknown) {
  if (!isObject(pageContext)) return undefined;
  const readables = (pageContext as PageContextLike).readables;
  if (!Array.isArray(readables)) return undefined;

  for (const readable of readables) {
    if (!isObject(readable) || readable.id !== "__ams_runtime_context") {
      continue;
    }
    const value = readable.value;
    if (!isObject(value)) return undefined;
    const route = value.route;
    if (typeof route === "string" && route.trim()) return route;
    if (isObject(route) && typeof route.pathname === "string" && route.pathname.trim()) {
      return route.pathname;
    }
  }
  return undefined;
}

function getActiveFormId(pageContext: unknown) {
  if (!isObject(pageContext)) return null;
  const readables = (pageContext as PageContextLike).readables;
  if (!Array.isArray(readables)) return null;

  for (const readable of readables) {
    if (!isObject(readable)) continue;
    const value = readable.value;
    if (!isObject(value)) continue;
    const activeForm = value.activeForm;
    if (!isObject(activeForm)) continue;
    const formId = activeForm.formId;
    if (typeof formId === "string" && formId.trim()) return formId;
  }
  return null;
}

function enrichActionResultWithPageState(
  interrupt: FrontendActionInterrupt,
  result: unknown,
  pageContext: unknown,
) {
  if (!isObject(result)) {
    return result;
  }

  const currentRoute = getCurrentRoute(pageContext);
  const activeFormId = getActiveFormId(pageContext);
  if (!currentRoute && activeFormId === null) {
    return result;
  }

  const targetFormId = stringArg(interrupt.action.args, ["formId", "form_id"]);
  const redirectTo =
    typeof result.redirectTo === "string" && result.redirectTo.trim()
      ? result.redirectTo
      : undefined;
  const isSubmit = interrupt.action.name === "request_form_submit";

  return {
    ...result,
    ...(currentRoute ? { currentRoute } : {}),
    activeFormId,
    ...(targetFormId && !isSubmit ? { targetFormId } : {}),
    ...(targetFormId && !isSubmit ? { targetFormStillActive: activeFormId === targetFormId } : {}),
    ...(isSubmit
      ? { formClosed: targetFormId ? activeFormId !== targetFormId : activeFormId === null }
      : {}),
    ...(isSubmit && targetFormId ? { submittedFormId: targetFormId } : {}),
    ...(isSubmit && currentRoute && redirectTo
      ? { routeMatchesRedirect: normalizeRoute(currentRoute) === normalizeRoute(redirectTo) }
      : {}),
  };
}

export async function runFrontendActionInterrupt(
  interrupt: FrontendActionInterrupt,
  deps: FrontendActionRunnerDeps,
) {
  try {
    notify(deps, "running", "Running browser action...");
    const result = await deps.callAction(
      interrupt.action.name,
      interrupt.action.args,
    );
    notify(
      deps,
      "resuming",
      "Browser action finished with ready page context. Returning control to the agent...",
    );
    const pageContext = await deps.getFreshContext();
    const resumeResult = enrichActionResultWithPageState(
      interrupt,
      result,
      pageContext,
    );
    deps.submit(
      {},
      {
        command: {
          resume: buildFrontendActionResume(interrupt, resumeResult),
        },
        config: buildAgentRunConfig(pageContext),
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
    const pageContext = await deps.getFreshContext().catch(() => null);
    deps.submit(
      {},
      {
        command: {
          resume: buildFrontendActionResume(interrupt, undefined, error),
        },
        config: buildAgentRunConfig(pageContext),
        streamMode: ["values", "custom"],
      },
    );
  }
}
