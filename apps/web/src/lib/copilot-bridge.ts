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

/**
 * Structured reason a "reject" decision can carry when the user made the
 * pending approval moot (without clicking the card). Lets the agent
 * distinguish "user said no" from "user already acted".
 */
export type HitlRejectionReason =
  | "user_submitted_manually"
  | "user_closed_form"
  | "user_navigated_away";

export type HitlDecision = {
  decision: "approve" | "reject";
  reason?: HitlRejectionReason;
};

type HitlDecisionMessage = {
  source: "ams-copilot";
  type: "HITL_DECISION";
  decision?: HitlDecision["decision"];
  reason?: HitlRejectionReason;
};

type ActionResultMessage = {
  source: "ams-copilot";
  type: "ACTION_RESULT";
  callId?: string;
  result?: unknown;
  error?: unknown;
};

type TranslateResultMessage = {
  source: "ams-copilot";
  type: "TRANSLATE_RESULT";
  callId?: string;
  translatedText?: string;
  error?: unknown;
};

type TranscribeResultMessage = {
  source: "ams-copilot";
  type: "TRANSCRIBE_RESULT";
  callId?: string;
  text?: string;
  error?: unknown;
};

/**
 * Proactive event emitted by the parent when a notification matches the
 * dispatcher rules. The iframe converts these into a single agent turn that
 * produces a brief offer card. The shape mirrors TypedNotificationEvent from
 * the parent — only the fields the iframe needs to compose the agent prompt.
 *
 * NOTE: The iframe MUST NOT treat this like a user message; the agent prompt
 * has a dedicated section explaining proactive turns produce ONE concise
 * OpenUI card with snooze/dismiss options, never a long lecture.
 */
export type ProactiveEvent = {
  /** Stable id from the originating notification — for client-side dedup. */
  id: number;
  /** Typed kind from notificationEvents.ts (already validated upstream). */
  kind: string;
  /** Suggested intent — the dispatcher only fires when this is set. */
  suggestedIntent: string;
  /** Pointer at the thing the intent should act on. */
  intentTarget: {
    form_id?: string;
    record_id?: number | string;
    module?: string;
    route?: string;
  };
  /** Human-readable title and message from the notification, for the card. */
  title: string;
  message: string;
  /** Notification severity, so the card can match the tone (info/warning). */
  severity: string;
};

type ProactiveEventMessage = {
  source: "ams-copilot";
  type: "PROACTIVE_EVENT";
  event?: ProactiveEvent;
};

export type PageContext = {
  readables: Readable[];
  actions: ActionDef[];
};

export type FreshContextOptions = {
  timeoutMs?: number;
  requireFresh?: boolean;
};

export const COPILOT_CONTEXT_EVENT = "ams-copilot-context-update";
export const COPILOT_VOICE_COMMAND_EVENT = "ams-copilot-voice-command";
export const COPILOT_HITL_DECISION_EVENT = "ams-copilot-hitl-decision";
export const COPILOT_PROACTIVE_EVENT = "ams-copilot-proactive-event";
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
  private pendingTranslations = new Map<
    string,
    {
      resolve: (value: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private pendingTranscriptions = new Map<
    string,
    {
      resolve: (value: string) => void;
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
      | VoiceCommandMessage
      | HitlDecisionMessage
      | TranslateResultMessage
      | TranscribeResultMessage
      | ProactiveEventMessage
    >;
    if (data.source !== "ams-copilot") return;

    if (data.type === "PROACTIVE_EVENT") {
      const payload = (data as ProactiveEventMessage).event;
      if (!payload || typeof payload !== "object") return;
      // Re-dispatch as a window event so the chat thread can react without
      // coupling to the bridge instance. The thread inspects its own stream
      // state before consuming — the parent already filtered for "agent
      // idle" but the iframe's view may be one tick fresher.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<ProactiveEvent>(COPILOT_PROACTIVE_EVENT, {
            detail: payload,
          }),
        );
      }
      return;
    }

    if (data.type === "TRANSCRIBE_RESULT") {
      const callId = data.callId;
      if (!callId) return;
      const pending = this.pendingTranscriptions.get(callId);
      if (!pending) return;
      this.pendingTranscriptions.delete(callId);
      clearTimeout(pending.timer);
      if (data.error) {
        pending.reject(new Error(String(data.error)));
      } else {
        pending.resolve(String(data.text ?? ""));
      }
      return;
    }

    if (data.type === "TRANSLATE_RESULT") {
      const callId = data.callId;
      if (!callId) return;
      const pending = this.pendingTranslations.get(callId);
      if (!pending) return;
      this.pendingTranslations.delete(callId);
      clearTimeout(pending.timer);
      if (data.error) {
        pending.reject(new Error(String(data.error)));
      } else {
        pending.resolve(String(data.translatedText ?? ""));
      }
      return;
    }

    if (data.type === "CONTEXT_UPDATE") {
      this.ingestContextUpdate({
        readables: data.readables,
        actions: data.actions,
      });
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
      const validReasons: HitlRejectionReason[] = [
        "user_submitted_manually",
        "user_closed_form",
        "user_navigated_away",
      ];
      const reason =
        data.decision === "reject" &&
        typeof data.reason === "string" &&
        (validReasons as string[]).includes(data.reason)
          ? (data.reason as HitlRejectionReason)
          : undefined;
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<HitlDecision>(COPILOT_HITL_DECISION_EVENT, {
            detail: reason
              ? { decision: data.decision, reason }
              : { decision: data.decision },
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

  getFreshContext(options: number | FreshContextOptions = {}): Promise<PageContext> {
    if (!this.hasParent()) return Promise.resolve(this.getContext());

    const timeoutMs = typeof options === "number" ? options : options.timeoutMs ?? 1500;
    const requireFresh =
      typeof options === "number" ? false : options.requireFresh === true;

    return new Promise<PageContext>((resolve, reject) => {
      const finish = (context: PageContext) => {
        clearTimeout(timer);
        this.pendingContextRequests.delete(finish);
        resolve(context);
      };

      const timer = setTimeout(() => {
        this.pendingContextRequests.delete(finish);
        if (requireFresh) {
          reject(
            new Error(
              "Fresh AMS page context was not received before the agent resume timeout.",
            ),
          );
          return;
        }
        resolve(this.getContext());
      }, timeoutMs);

      this.pendingContextRequests.add(finish);
      this.requestContext();
    });
  }

  hasParent(): boolean {
    return typeof window !== "undefined" && window.parent !== window;
  }

  async transcribe(blob: Blob, language = "ur"): Promise<string> {
    if (!this.hasParent() || blob.size === 0) return "";
    const arrayBuffer = await blob.arrayBuffer();
    const callId =
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingTranscriptions.has(callId)) {
          this.pendingTranscriptions.delete(callId);
          reject(new Error("Transcribe request timed out"));
        }
      }, 30_000);
      this.pendingTranscriptions.set(callId, { resolve, reject, timer });
      window.parent.postMessage(
        {
          source: "ams-copilot-iframe",
          type: "TRANSCRIBE_REQUEST",
          callId,
          audio: arrayBuffer,
          mimeType: blob.type || "audio/webm",
          language,
        },
        TRUSTED_PARENT_ORIGIN ?? "*",
        [arrayBuffer],
      );
    });
  }

  translate(text: string, target = "en", source = "ur"): Promise<string> {
    if (!this.hasParent() || !text.trim()) return Promise.resolve(text);
    const callId =
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingTranslations.has(callId)) {
          this.pendingTranslations.delete(callId);
          reject(new Error("Translate request timed out"));
        }
      }, 10_000);
      this.pendingTranslations.set(callId, { resolve, reject, timer });
      window.parent.postMessage(
        {
          source: "ams-copilot-iframe",
          type: "TRANSLATE_REQUEST",
          callId,
          text,
          target,
          sourceLang: source,
        },
        TRUSTED_PARENT_ORIGIN ?? "*",
      );
    });
  }

  requestVoiceCapture(): boolean {
    if (!this.hasParent()) return false;
    window.parent.postMessage(
      { source: "ams-copilot-iframe", type: "START_VOICE_CAPTURE" },
      TRUSTED_PARENT_ORIGIN ?? "*",
    );
    return true;
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
