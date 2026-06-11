import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

type ToolCallLike = { id?: string; name?: string; args?: unknown };
type MessageLike = {
  tool_calls?: ToolCallLike[];
  kwargs?: { tool_calls?: ToolCallLike[] };
};

const FRONTEND_SUBAGENT_NAME = "frontend_controller";

// The orchestrator prompt already forbids parallel task(...) calls, but the
// deepagents harness injects its own task-tool description that encourages
// parallel delegation, so the model occasionally emits two task calls in one
// turn anyway. Two frontend_controller subagents then drive the user's single
// live browser session at once: one navigates while the other is mid-form-fill
// and their frontend results collide. This guard is the deterministic
// backstop: it lets the FIRST frontend_controller call run, defers any extra
// parallel frontend_controller calls with a ToolMessage instructing the model
// to re-issue them once the running task reports back, and leaves non-frontend
// delegations (e.g. sql_analyst) untouched — they don't share the browser.
// The deferral message is deliberately NOT an error: the model should treat
// it as "queued, continue the work", never as a failure to report or a reason
// to stop.
const DEFER_MESSAGE =
  "DEFERRED, not failed: you issued two frontend_controller delegations in the same turn, " +
  "but only one frontend_controller task can drive the user's browser at a time — parallel " +
  "frontend tasks collide on the same live page (one navigates while the other is mid-form) " +
  "and corrupt each other's work. This delegation has NOT run yet. As soon as the running " +
  "task's result arrives, immediately re-issue this exact delegation (same description) as " +
  "your next tool call and continue the work to completion. Do not stop, do not ask the " +
  "user, and do not report this as an error. For the rest of this conversation, issue " +
  "frontend_controller delegations strictly ONE AT A TIME: wait for each task result before " +
  "sending the next delegation.";

function getToolCalls(message: MessageLike | undefined) {
  return message?.tool_calls ?? message?.kwargs?.tool_calls ?? [];
}

function getSubagentType(call: ToolCallLike): string | null {
  let args = call.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!args || typeof args !== "object") return null;
  const subagentType = (args as { subagent_type?: unknown }).subagent_type;
  return typeof subagentType === "string" ? subagentType : null;
}

export function getParallelTaskBlocks(messages: MessageLike[]): ToolMessage[] {
  const last = messages.at(-1);
  const frontendCalls = getToolCalls(last).filter(
    (call) =>
      call?.name === "task" &&
      getSubagentType(call) === FRONTEND_SUBAGENT_NAME,
  );
  if (frontendCalls.length <= 1) return [];
  return frontendCalls.slice(1).flatMap((call) =>
    call.id
      ? [
          new ToolMessage({
            content: DEFER_MESSAGE,
            tool_call_id: call.id,
            name: "task",
          }),
        ]
      : [],
  );
}

export const serialTaskGuardMiddleware = createMiddleware({
  name: "SerialTaskGuardMiddleware",
  afterModel: {
    hook: (state) => {
      const blocks = getParallelTaskBlocks(
        (state.messages ?? []) as MessageLike[],
      );
      if (blocks.length === 0) return undefined;
      return { messages: blocks };
    },
  },
});
