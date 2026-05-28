import type { ProactiveEvent } from "@/lib/copilot-bridge";

/**
 * Build the prompt the agent sees when a proactive event arrives.
 *
 * The prompt is intentionally structured: it opens with a clear marker
 * (`__AMS_PROACTIVE_EVENT__`) so the orchestrator's prompt rule can detect
 * it and route to the proactive-card behaviour instead of the regular
 * user-message behaviour. The fields are flattened for easy scanning by
 * the model — no nested JSON to parse.
 *
 * The agent's job on receiving this: produce ONE compact OpenUI card that
 * offers help based on `suggested_intent` + `intent_target`, with optional
 * snooze controls. Never lecture, never list internals, never re-state the
 * notification body verbatim — just offer the next move.
 */
export function buildProactiveEventPrompt(event: ProactiveEvent): string {
  const target = event.intentTarget ?? {};
  const targetLines = [
    target.form_id ? `  form_id: ${target.form_id}` : null,
    target.record_id !== undefined && target.record_id !== null ? `  record_id: ${String(target.record_id)}` : null,
    target.module ? `  module: ${target.module}` : null,
    target.route ? `  route: ${target.route}` : null,
  ].filter(Boolean).join("\n");

  return [
    "__AMS_PROACTIVE_EVENT__",
    "This is a proactive trigger from the AMS notification system, NOT a direct user message. Compose one short OpenUI card offering the next action the user is likely to want. Be concise — no preamble, no recap of the notification body.",
    "",
    `kind: ${event.kind}`,
    `suggested_intent: ${event.suggestedIntent}`,
    `severity: ${event.severity}`,
    `notification_title: ${event.title}`,
    `notification_message: ${event.message}`,
    "intent_target:",
    targetLines || "  (none)",
  ].join("\n");
}
