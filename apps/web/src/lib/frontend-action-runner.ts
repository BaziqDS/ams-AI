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

function contextFingerprint(context: unknown) {
  try {
    return JSON.stringify(context);
  } catch {
    return String(context);
  }
}

async function waitForFreshActionContext(
  deps: FrontendActionRunnerDeps,
  beforeContext: unknown,
) {
  const before = contextFingerprint(beforeContext);
  let latest = beforeContext;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    latest = await deps.getFreshContext();
    if (contextFingerprint(latest) !== before) return latest;
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
    const pageContext = await waitForFreshActionContext(deps, beforeContext);
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
