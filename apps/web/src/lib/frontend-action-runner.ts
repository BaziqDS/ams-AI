import {
  buildFrontendActionResume,
  type FrontendActionInterrupt,
} from "./frontend-action-interrupt";
import { buildAgentRunConfig } from "./agent-run-config";

type FrontendActionStatus = "running" | "resuming" | "completed" | "failed";

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
    deps.submit(
      {},
      {
        command: {
          resume: buildFrontendActionResume(interrupt, result),
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
