"use client";

export type Readable = { id: string; description: string; value: unknown };
export type ActionDef = {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description?: string; required?: boolean }>;
  permissions?: {
    requiredPermissions?: string[];
    requiredCapabilities?: Array<{ module: string; level?: string }>;
  };
  allowed?: boolean;
};

type ContextMessage = {
  source: "ams-copilot";
  type: "CONTEXT_UPDATE";
  readables?: Readable[];
  actions?: ActionDef[];
};

export type SupportNudge = {
  id: string;
  kind: string;
  title: string;
  message: string;
  route?: string;
  module?: string;
  severity?: string;
  prompt?: string;
  createdAt?: string;
};

type SupportNudgeMessage = {
  source: "ams-copilot";
  type: "SUPPORT_NUDGE";
  nudge?: SupportNudge;
};

export type VoiceCommand = {
  id: string;
  text: string;
  source?: "voice";
  createdAt?: string;
};

type VoiceCommandMessage = {
  source: "ams-copilot";
  type: "VOICE_COMMAND";
  command?: VoiceCommand;
};

export type HitlDecision = {
  decision: "approve" | "reject";
};

type HitlDecisionMessage = {
  source: "ams-copilot";
  type: "HITL_DECISION";
  decision?: HitlDecision["decision"];
};

type ActionResultMessage = {
  source: "ams-copilot";
  type: "ACTION_RESULT";
  callId?: string;
  result?: unknown;
  error?: unknown;
};

export type PageContext = {
  readables: Readable[];
  actions: ActionDef[];
};

export const COPILOT_CONTEXT_EVENT = "ams-copilot-context-update";
export const COPILOT_SUPPORT_NUDGE_EVENT = "ams-copilot-support-nudge";
export const COPILOT_VOICE_COMMAND_EVENT = "ams-copilot-voice-command";
export const COPILOT_HITL_DECISION_EVENT = "ams-copilot-hitl-decision";
const FRONTEND_ACTION_TIMEOUT_MS = 15_000;

const TRUSTED_PARENT_ORIGIN = process.env.NEXT_PUBLIC_AMS_ORIGIN?.replace(
  /\/$/,
  "",
);

export class CopilotBridge {
  private readables: Readable[] = [];
  private actions: ActionDef[] = [];
  private pendingContextRequests = new Set<(context: PageContext) => void>();
  private pendingCalls = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private initialized = false;

  init() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    window.addEventListener("message", this.handleMessage);
    this.requestContext();
  }

  destroy() {
    if (!this.initialized || typeof window === "undefined") return;
    this.initialized = false;
    window.removeEventListener("message", this.handleMessage);
  }

  private handleMessage = (event: MessageEvent) => {
    if (TRUSTED_PARENT_ORIGIN && event.origin !== TRUSTED_PARENT_ORIGIN) return;
    if (!event.data || typeof event.data !== "object") return;

    const data = event.data as Partial<
      | ContextMessage
      | ActionResultMessage
      | SupportNudgeMessage
      | VoiceCommandMessage
      | HitlDecisionMessage
    >;
    if (data.source !== "ams-copilot") return;

    if (data.type === "CONTEXT_UPDATE") {
      this.ingestContextUpdate({
        readables: data.readables,
        actions: data.actions,
      });
      return;
    }

    if (data.type === "SUPPORT_NUDGE") {
      if (!data.nudge || typeof data.nudge !== "object") return;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<SupportNudge>(COPILOT_SUPPORT_NUDGE_EVENT, {
            detail: data.nudge,
          }),
        );
      }
      return;
    }

    if (data.type === "VOICE_COMMAND") {
      if (!data.command || typeof data.command !== "object") return;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<VoiceCommand>(COPILOT_VOICE_COMMAND_EVENT, {
            detail: data.command,
          }),
        );
      }
      return;
    }

    if (data.type === "HITL_DECISION") {
      if (data.decision !== "approve" && data.decision !== "reject") return;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<HitlDecision>(COPILOT_HITL_DECISION_EVENT, {
            detail: { decision: data.decision },
          }),
        );
      }
      return;
    }

    if (data.type === "ACTION_RESULT") {
      const callId = data.callId;
      if (!callId) return;
      const pending = this.pendingCalls.get(callId);
      if (!pending) return;
      this.pendingCalls.delete(callId);
      clearTimeout(pending.timer);
      if (data.error) {
        pending.reject(new Error(String(data.error)));
      } else {
        pending.resolve(data.result ?? null);
      }
    }
  };

  ingestContextUpdate(update: {
    readables?: Readable[];
    actions?: ActionDef[];
  }) {
    this.readables = Array.isArray(update.readables) ? update.readables : [];
    this.actions = Array.isArray(update.actions) ? update.actions : [];

    const context = this.getContext();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<PageContext>(COPILOT_CONTEXT_EVENT, {
          detail: context,
        }),
      );
    }
    for (const resolve of this.pendingContextRequests) {
      resolve(context);
    }
    this.pendingContextRequests.clear();
  }

  private requestContext() {
    if (typeof window === "undefined" || !window.parent) return;
    window.parent.postMessage(
      { source: "ams-copilot-iframe", type: "REQUEST_CONTEXT" },
      TRUSTED_PARENT_ORIGIN ?? "*",
    );
  }

  getContext(): PageContext {
    return {
      readables: this.readables,
      actions: this.actions,
    };
  }

  getFreshContext(timeoutMs = 1500): Promise<PageContext> {
    if (!this.hasParent()) return Promise.resolve(this.getContext());

    return new Promise<PageContext>((resolve) => {
      const finish = (context: PageContext) => {
        clearTimeout(timer);
        this.pendingContextRequests.delete(finish);
        resolve(context);
      };

      const timer = setTimeout(() => {
        this.pendingContextRequests.delete(finish);
        resolve(this.getContext());
      }, timeoutMs);

      this.pendingContextRequests.add(finish);
      this.requestContext();
    });
  }

  hasParent(): boolean {
    return typeof window !== "undefined" && window.parent !== window;
  }

  callAction(name: string, args: unknown): Promise<unknown> {
    if (!this.hasParent()) {
      return Promise.reject(new Error("Not embedded - no parent window to call"));
    }

    const callId =
      Math.random().toString(36).slice(2) + Date.now().toString(36);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCalls.has(callId)) {
          this.pendingCalls.delete(callId);
          reject(new Error(`Frontend action "${name}" timed out`));
        }
      }, FRONTEND_ACTION_TIMEOUT_MS);

      this.pendingCalls.set(callId, { resolve, reject, timer });
      window.parent.postMessage(
        {
          source: "ams-copilot-iframe",
          type: "CALL_ACTION",
          callId,
          name,
          args,
        },
        TRUSTED_PARENT_ORIGIN ?? "*",
      );
    });
  }
}

export const copilotBridge = new CopilotBridge();

if (typeof window !== "undefined") {
  copilotBridge.init();
}
