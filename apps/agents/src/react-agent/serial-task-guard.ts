import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

type ToolCallLike = { id?: string; name?: string; args?: unknown };
type MessageLike = {
  tool_calls?: ToolCallLike[];
  kwargs?: { tool_calls?: ToolCallLike[] };
};

const FRONTEND_SUBAGENT_NAME = "frontend_controller";

// The orchestrator prompt forbids parallel task(...) calls and the deepagents
// task-tool guidance has been patched to demand serial subagents, but a weak
// model can still occasionally emit two frontend_controller task calls in one
// turn. Two frontend_controller subagents then drive the user's single live
// browser session at once: one navigates while the other is mid-form-fill and
// their frontend results collide. This guard is the deterministic backstop —
// it lets the FIRST frontend_controller call run and neutralizes every extra
// parallel frontend_controller call, leaving non-frontend delegations (e.g.
// sql_analyst) untouched because they don't share the browser.
//
// There are TWO kinds of extra frontend calls, handled differently:
//
//   1. DUPLICATE — same delegation description as one already kept this turn.
//      This is a hallucinated repeat (the #1 cause of "the frontend subagent
//      ran twice"). It is DROPPED: the model is told the work is already
//      running and must NOT re-issue it. Re-issuing would run the same browser
//      work a second time.
//
//   2. DISTINCT — a different delegation that genuinely needs to happen, just
//      not in parallel. It is DEFERRED: the model is told to re-issue it once
//      the running task reports back, so the work is serialized, not lost.
//
// Neither message is an error: the model should treat them as "handled,
// continue the work", never as a failure to report or a reason to stop. In
// both cases the injected ToolMessage answers the extra tool_call before the
// tool node runs, so the duplicate/deferred subagent never actually executes.

const DEFER_MESSAGE =
  "DEFERRED, not failed: you issued more than one frontend_controller delegation in the same turn, " +
  "but only one frontend_controller task can drive the user's browser at a time — parallel " +
  "frontend tasks collide on the same live page (one navigates while the other is mid-form) " +
  "and corrupt each other's work. This delegation has NOT run yet. As soon as the running " +
  "task's result arrives, immediately re-issue this exact delegation (same description) as " +
  "your next tool call and continue the work to completion. Do not stop, do not ask the " +
  "user, and do not report this as an error. For the rest of this conversation, issue " +
  "frontend_controller delegations strictly ONE AT A TIME: wait for each task result before " +
  "sending the next delegation.";

const DROP_MESSAGE =
  "DISCARDED duplicate, not failed: you issued the SAME frontend_controller delegation more " +
  "than once in a single turn. Only the first copy is running; this duplicate has been " +
  "discarded and performed NO action. Do NOT re-issue it and do NOT report an error — the " +
  "running copy already covers this exact work, and re-running it would drive the user's " +
  "browser twice and corrupt the result. Wait for the running task's result, then continue. " +
  "For the rest of this conversation, issue frontend_controller delegations strictly ONE AT " +
  "A TIME: wait for each task result before sending the next delegation.";

function getToolCalls(message: MessageLike | undefined) {
  return message?.tool_calls ?? message?.kwargs?.tool_calls ?? [];
}

function parseArgs(call: ToolCallLike): Record<string, unknown> | null {
  let args = call.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!args || typeof args !== "object") return null;
  return args as Record<string, unknown>;
}

function getSubagentType(call: ToolCallLike): string | null {
  const args = parseArgs(call);
  const subagentType = args?.subagent_type;
  return typeof subagentType === "string" ? subagentType : null;
}

// Normalized delegation description, used to recognize exact-duplicate calls.
// Whitespace and case are collapsed so trivially-different repeats still match;
// a missing description normalizes to "" (so two argless duplicates collide).
function getNormalizedDescription(call: ToolCallLike): string {
  const args = parseArgs(call);
  const description = args?.description;
  return typeof description === "string"
    ? description.trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}

export function getParallelTaskBlocks(messages: MessageLike[]): ToolMessage[] {
  const last = messages.at(-1);
  const frontendCalls = getToolCalls(last).filter(
    (call) =>
      call?.name === "task" &&
      getSubagentType(call) === FRONTEND_SUBAGENT_NAME,
  );
  if (frontendCalls.length <= 1) return [];

  // The first frontend call runs. Track the descriptions already accounted for
  // (the running one plus any we defer) so a later call matching any of them is
  // recognized as a duplicate and dropped rather than deferred-and-re-issued.
  const seenDescriptions = new Set<string>([
    getNormalizedDescription(frontendCalls[0]),
  ]);

  const blocks: ToolMessage[] = [];
  for (const call of frontendCalls.slice(1)) {
    if (!call.id) continue;
    const description = getNormalizedDescription(call);
    const isDuplicate = seenDescriptions.has(description);
    if (!isDuplicate) seenDescriptions.add(description);
    blocks.push(
      new ToolMessage({
        content: isDuplicate ? DROP_MESSAGE : DEFER_MESSAGE,
        tool_call_id: call.id,
        name: "task",
      }),
    );
  }
  return blocks;
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
