import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

type ToolCallLike = { id?: string; name?: string; args?: unknown };
type MessageLike = {
  tool_calls?: ToolCallLike[];
  kwargs?: { tool_calls?: ToolCallLike[] };
};

// Every tool listed here round-trips to the live browser through a LangGraph
// interrupt(): the graph pauses, the chat iframe runs ONE action via the
// copilot bridge, and resumes the graph with ONE bare resume value. LangGraph
// resolves ALL pending interrupts with a bare resume value, so when the model
// emits two of these calls in one turn, only one action actually runs in the
// browser and BOTH tool calls receive that single action's result — the other
// call gets a result for a field/route it never asked about and the model
// reasons from corrupted data. The system prompt forbids parallel calls and
// model-config sends parallel_tool_calls=false, but several OpenRouter
// providers ignore both, so this guard is the deterministic backstop.
const BROWSER_ROUNDTRIP_TOOL_NAMES = new Set([
  "navigate_to_route",
  "open_form",
  "set_form_values",
  "search_form_options",
  "request_form_submit",
  "run_frontend_action",
  "get_app_map",
]);

// Like the serial task guard's deferral, this must NOT read as a failure: the
// model should re-issue the deferred call after the running one returns, not
// stop or report an error to the user.
const DEFER_MESSAGE =
  "DEFERRED, not failed: you issued multiple browser tool calls in the same turn, " +
  "but frontend tools round-trip to the user's live browser strictly one at a time — " +
  "parallel calls collide and every call receives the result of a single action, so " +
  "you would be reasoning from another field's data. This call has NOT run yet. As " +
  "soon as the first call's result arrives, re-issue this exact call (same tool, same " +
  "args) as your next single tool call and continue the work. Do not stop, do not ask " +
  "the user, and do not report this as an error. For the rest of this conversation, " +
  "issue browser tool calls strictly ONE AT A TIME: wait for each result before " +
  "sending the next call.";

function getToolCalls(message: MessageLike | undefined) {
  return message?.tool_calls ?? message?.kwargs?.tool_calls ?? [];
}

export function getParallelFrontendToolBlocks(
  messages: MessageLike[],
): ToolMessage[] {
  const last = messages.at(-1);
  const browserCalls = getToolCalls(last).filter(
    (call) =>
      typeof call?.name === "string" &&
      BROWSER_ROUNDTRIP_TOOL_NAMES.has(call.name),
  );
  if (browserCalls.length <= 1) return [];
  return browserCalls.slice(1).flatMap((call) =>
    call.id && call.name
      ? [
          new ToolMessage({
            content: DEFER_MESSAGE,
            tool_call_id: call.id,
            name: call.name,
          }),
        ]
      : [],
  );
}

export const serialFrontendToolGuardMiddleware = createMiddleware({
  name: "SerialFrontendToolGuardMiddleware",
  afterModel: {
    hook: (state) => {
      const blocks = getParallelFrontendToolBlocks(
        (state.messages ?? []) as MessageLike[],
      );
      if (blocks.length === 0) return undefined;
      return { messages: blocks };
    },
  },
});
