import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useStreamContext } from "@/providers/Stream";
import { copilotBridge } from "@/lib/copilot-bridge";
import type { FrontendActionInterrupt } from "@/lib/frontend-action-interrupt";
import { runFrontendActionInterrupt } from "@/lib/frontend-action-runner";

function actionTitle(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FrontendActionInterruptView({
  interrupt,
}: {
  interrupt: FrontendActionInterrupt;
}) {
  const thread = useStreamContext();
  const submitRef = useRef(thread.submit);
  const mountedRef = useRef(false);
  const startedActionKeyRef = useRef<string | null>(null);
  const actionKey = useMemo(
    () => JSON.stringify({
      name: interrupt.action.name,
      args: interrupt.action.args ?? null,
    }),
    [interrupt.action.name, interrupt.action.args],
  );
  const [status, setStatus] = useState<
    "running" | "resuming" | "completed" | "failed"
  >("running");
  const [message, setMessage] = useState("Running browser action...");

  useEffect(() => {
    submitRef.current = thread.submit;
  }, [thread.submit]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (startedActionKeyRef.current === actionKey) return;
    startedActionKeyRef.current = actionKey;

    runFrontendActionInterrupt(interrupt, {
      callAction: (name, args) => copilotBridge.callAction(name, args),
      getFreshContext: () =>
        copilotBridge.getFreshContext({ timeoutMs: 5000, requireFresh: true }),
      submit: (values, options) => submitRef.current(values, options),
      isMounted: () => mountedRef.current,
      onStatus: (nextStatus, nextMessage) => {
        setStatus(nextStatus);
        setMessage(nextMessage);
      },
    }).catch((error) => {
      console.error("[copilot/interrupt] frontend action runner failed:", error);
    });
  }, [actionKey, interrupt]);

  function StatusIcon() {
    if (status === "completed") {
      return <CheckCircle2 className="size-4 shrink-0" />;
    }
    if (status === "failed") {
      return <AlertCircle className="size-4 shrink-0" />;
    }
    return <LoaderCircle className="size-4 shrink-0 animate-spin" />;
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-blue-200 bg-blue-50/60 text-blue-950 shadow-sm">
      <div className="flex min-w-0 items-center gap-2 px-4 py-2.5 border-b border-blue-200/70">
        <StatusIcon />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {actionTitle(interrupt.action.name)}
        </span>
        <span className="ml-auto text-xs text-blue-800/80">{status}</span>
      </div>
      <div className="min-w-0 break-all px-4 py-3 text-xs leading-relaxed text-blue-900">
        {message}
      </div>
    </div>
  );
}
