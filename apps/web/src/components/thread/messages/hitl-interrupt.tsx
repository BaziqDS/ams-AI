import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStreamContext } from "@/providers/Stream";
import { copilotBridge } from "@/lib/copilot-bridge";
import {
  buildHitlResume,
  type HitlRequest,
} from "@/lib/hitl-interrupt";
import { buildAgentRunConfig } from "@/lib/agent-run-config";

function summarizeArgs(args: Record<string, unknown>): string[] {
  return Object.entries(args)
    .map(([key, value]) => {
      const rendered =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      return `${key}: ${rendered}`;
    })
    .slice(0, 8);
}

function actionTitle(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function HitlInterruptView({ interrupt }: { interrupt: HitlRequest }) {
  const thread = useStreamContext();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const resume = async (decision: "approve" | "reject") => {
    if (busy || thread.isLoading) return;
    setBusy(decision);
    const pageContext = await copilotBridge.getFreshContext({
      timeoutMs: 5000,
      requireFresh: true,
    });

    try {
      thread.submit(
        {},
        {
          command: {
            resume: buildHitlResume(interrupt, decision),
          },
          config: buildAgentRunConfig(pageContext),
          streamMode: ["values", "custom"],
        },
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/50 text-amber-950 shadow-sm">
      <div className="flex min-w-0 items-center gap-2 border-b border-amber-200/70 px-3 py-2.5 sm:px-4">
        <ShieldCheck className="size-4 shrink-0" />
        <span className="min-w-0 truncate text-sm font-semibold">
          Approval required
        </span>
        <span className="ml-auto shrink-0 text-xs text-amber-800/80">
          {interrupt.actionRequests.length} action
          {interrupt.actionRequests.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="max-h-[min(24rem,65vh)] min-w-0 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
        {interrupt.actionRequests.map((action, index) => {
          const summary = summarizeArgs(action.args);
          return (
            <div
              key={`${action.name}-${index}`}
              className="min-w-0 space-y-1.5 overflow-hidden rounded-md border border-amber-200/60 bg-white px-3 py-2.5"
            >
              <div className="truncate text-sm font-semibold text-gray-900">
                {actionTitle(action.name)}
              </div>
              {action.description ? (
                <div className="break-words text-xs leading-relaxed text-gray-600">
                  {action.description}
                </div>
              ) : null}
              {summary.length > 0 && (
                <ul className="mt-1 max-h-32 min-w-0 space-y-0.5 overflow-y-auto overflow-x-hidden font-mono text-xs leading-relaxed text-gray-700">
                  {summary.map((line, i) => (
                    <li
                      key={i}
                      className="min-w-0 whitespace-pre-wrap break-all"
                      title={line}
                    >
                      <span className="text-gray-400">›</span> {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => resume("reject")}
            disabled={Boolean(busy) || thread.isLoading}
          >
            <X className="size-3.5" />
            {busy === "reject" ? "Rejecting..." : "Reject"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => resume("approve")}
            disabled={Boolean(busy) || thread.isLoading}
          >
            <Check className="size-3.5" />
            {busy === "approve" ? "Approving..." : "Approve"}
          </Button>
        </div>
      </div>
    </div>
  );
}
