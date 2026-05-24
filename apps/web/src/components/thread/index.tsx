"use client";

import { v4 as uuidv4 } from "uuid";
import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useStreamContext } from "@/providers/Stream";
import type { TodoItem } from "@/providers/Stream";
import { CLEAR_EMBEDDED_THREAD_EVENT } from "@/providers/Stream";
import { useState, FormEvent } from "react";
import { Button } from "../ui/button";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import { AssistantMessage, AssistantMessageLoading } from "./messages/ai";
import { HumanMessage } from "./messages/human";
import { getContentString } from "./utils";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import { TooltipIconButton } from "./tooltip-icon-button";
import {
  ArrowDown,
  LoaderCircle,
  Mic,
  PanelRightOpen,
  PanelRightClose,
  Plus,
  SendHorizontal,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { useQueryState, parseAsBoolean } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import {
  COPILOT_CONTEXT_EVENT,
  COPILOT_HITL_DECISION_EVENT,
  COPILOT_VOICE_COMMAND_EVENT,
  copilotBridge,
  type HitlDecision,
  type PageContext,
  type VoiceCommand,
} from "@/lib/copilot-bridge";
import {
  buildHitlResume,
  isHitlInterruptSchema,
} from "@/lib/hitl-interrupt";
import { buildVoiceCommandPrompt } from "@/lib/voice-command";
import { buildAgentRunConfig } from "@/lib/agent-run-config";
import { TodosPanel } from "./todos-panel";
import { getRenderableChatMessages } from "@/lib/chat-message-visibility";

const NO_PROACTIVE_RESPONSE = "__AMS_NO_PROACTIVE_RESPONSE__";
const RESILIENT_STREAM_OPTIONS = {
  onDisconnect: "continue" as const,
};

type ContextChipState = {
  kind: "form" | "list" | "detail" | "page";
  title: string;
  meta?: string;
  iconKey?: string;
};

function startNewThread(resetThread: () => void) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CLEAR_EMBEDDED_THREAD_EVENT));
  }
  resetThread();
}

function notifyParentAssistantMessage(
  messageId: string | undefined,
  text: string,
) {
  if (!messageId || typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    {
      source: "ams-copilot-iframe",
      type: "ASSISTANT_MESSAGE",
      messageId,
      text,
    },
    "*",
  );
}

function notifyParentHumanMessage(messageId: string | undefined, text: string) {
  if (!messageId || typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    {
      source: "ams-copilot-iframe",
      type: "HUMAN_MESSAGE",
      messageId,
      text,
    },
    "*",
  );
}

function notifyParentAssistantLoading(isLoading: boolean) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    {
      source: "ams-copilot-iframe",
      type: "ASSISTANT_LOADING",
      isLoading,
    },
    "*",
  );
}

function notifyParentReady(threadId: string | null) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    {
      source: "ams-copilot-iframe",
      type: "COPILOT_READY",
      threadId,
    },
    "*",
  );
}

function notifyParentTodoState(todos: TodoItem[]) {
  if (typeof window === "undefined" || window.parent === window) return;
  const current = todos.find((todo) => todo.status === "in_progress") ?? null;
  window.parent.postMessage(
    {
      source: "ams-copilot-iframe",
      type: "TODO_STATE",
      current,
    },
    "*",
  );
}

function notifyParentHitlInterrupt(value: unknown) {
  if (typeof window === "undefined" || window.parent === window) return;
  if (isHitlInterruptSchema(value)) {
    window.parent.postMessage(
      {
        source: "ams-copilot-iframe",
        type: "HITL_INTERRUPT",
        interrupt: value,
      },
      "*",
    );
    return;
  }

  window.parent.postMessage(
    {
      source: "ams-copilot-iframe",
      type: "HITL_INTERRUPT_CLEARED",
    },
    "*",
  );
}

function readPathname(context: PageContext | null): string | null {
  const runtime = context?.readables.find(
    (readable) => readable.id === "__ams_runtime_context",
  )?.value as { route?: { pathname?: unknown } } | undefined;
  return typeof runtime?.route?.pathname === "string"
    ? runtime.route.pathname
    : null;
}

function formatRouteLabel(pathname: string | null): string {
  if (!pathname) return "AMS";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "Overview";
  const [section, id] = segments;
  const name = section
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  // Singular for a specific record, plural section name for the list.
  const singular = name.endsWith("ies")
    ? `${name.slice(0, -3)}y`
    : name.endsWith("s")
      ? name.slice(0, -1)
      : name;
  return id ? `${singular} #${id}` : name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatEntityLabel(value: unknown, fallback: string) {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  return raw
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function recordDisplayName(record: Record<string, unknown>, fallback: string): string {
  const primary =
    compactText(record.name) ??
    compactText(record.title) ??
    compactText(record.label) ??
    compactText(record.display_name) ??
    compactText(record.category_display) ??
    compactText(record.item_name);
  const code =
    compactText(record.code) ??
    compactText(record.item_code) ??
    compactText(record.contract_no) ??
    compactText(record.contract_number);

  if (primary && code && !primary.includes(code)) return `${primary} (${code})`;
  if (primary) return primary;
  if (code) return code;

  const id = record.id;
  return typeof id === "string" || typeof id === "number"
    ? `${fallback} #${id}`
    : fallback;
}

function contextIconKey(pathname: string | null, entity?: unknown) {
  const haystack = `${pathname ?? ""} ${String(entity ?? "")}`.toLowerCase();
  if (haystack.includes("categor")) return "categories";
  if (haystack.includes("location")) return "locations";
  if (haystack.includes("item")) return "items";
  if (haystack.includes("stock-register")) return "stock-registers";
  if (haystack.includes("stock-entr")) return "stock-entries";
  if (haystack.includes("inspection")) return "inspections";
  if (haystack.includes("maintenance")) return "maintenance";
  if (haystack.includes("depreciation")) return "depreciation";
  if (haystack.includes("user")) return "users";
  if (haystack.includes("role")) return "roles";
  return "page";
}

function ContextChipIcon({ iconKey }: { iconKey?: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {iconKey === "locations" ? (
        <>
          <path {...common} d="M12 21s-7-6.5-7-12a7 7 0 1114 0c0 5.5-7 12-7 12z" />
          <circle {...common} cx="12" cy="9" r="2.5" />
        </>
      ) : iconKey === "categories" ? (
        <>
          <path {...common} d="M20.5 13.5l-7 7a1.5 1.5 0 01-2.12 0L3 12.12V3h9.12l8.38 8.38a1.5 1.5 0 010 2.12z" />
          <circle cx="7.5" cy="7.5" r="1.15" fill="currentColor" />
        </>
      ) : iconKey === "items" ? (
        <>
          <path {...common} d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
          <path {...common} d="M3.3 7L12 12l8.7-5M12 22V12" />
        </>
      ) : iconKey === "stock-entries" || iconKey === "page" ? (
        <>
          <path {...common} d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <path {...common} d="M14 3v6h6M9 13h6M9 17h4" />
        </>
      ) : iconKey === "inspections" ? (
        <>
          <path {...common} d="M9 11l3 3 7-7" />
          <path {...common} d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </>
      ) : iconKey === "maintenance" ? (
        <>
          <path {...common} d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.1-3.1a5 5 0 01-6.6 6.6l-6 6a2.1 2.1 0 01-3-3l6-6a5 5 0 016.6-6.6z" />
          <path {...common} d="M4 20l4-4" />
        </>
      ) : iconKey === "stock-registers" ? (
        <>
          <path {...common} d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path {...common} d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </>
      ) : iconKey === "depreciation" ? (
        <>
          <path {...common} d="M4 19h16M7 16V8M12 16V5M17 16v-3" />
          <path {...common} d="M5 8l5-5 4 4 5-5" />
        </>
      ) : iconKey === "users" ? (
        <>
          <circle {...common} cx="9" cy="8" r="3.2" />
          <path {...common} d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle {...common} cx="17" cy="7" r="2.6" />
          <path {...common} d="M21 19c0-2.7-1.8-5-4.5-5" />
        </>
      ) : iconKey === "roles" ? (
        <>
          <rect {...common} x="4" y="5" width="16" height="14" rx="3" />
          <path {...common} d="M8 9h8M8 13h5" />
        </>
      ) : (
        <>
          <path {...common} d="M3 12l9-8 9 8" />
          <path {...common} d="M5 10v10h14V10" />
        </>
      )}
    </svg>
  );
}

function deriveContextChip(context: PageContext | null): ContextChipState | null {
  const pathname = readPathname(context);
  if (!context?.readables.length && !pathname) return null;

  const activeForm = context?.readables.find((readable) => {
    const value = readable.value as
      | { formId?: unknown; active?: unknown; activeForm?: { formId?: unknown } }
      | undefined;
    return (
      (typeof value?.formId === "string" && value.active === true) ||
      typeof value?.activeForm?.formId === "string"
    );
  })?.value as
    | { formId?: string; activeForm?: { formId?: string; title?: string } }
    | undefined;

  const activeFormId = activeForm?.activeForm?.formId ?? activeForm?.formId;
  const activeFormTitle = activeForm?.activeForm?.title;
  if (activeFormId) {
    const name = (activeFormTitle || activeFormId)
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      kind: "form",
      title: `${name} form`,
      iconKey: contextIconKey(pathname, activeFormId),
    };
  }

  const detailContext = context?.readables.find((readable) => {
    const value = readable.value;
    return (
      isRecord(value) &&
      value.page_kind === "detail" &&
      typeof value.route === "string" &&
      value.route === pathname
    );
  })?.value as
    | {
        entity?: unknown;
        selected_record?: unknown;
      }
    | undefined;

  if (detailContext) {
    const entityLabel = formatEntityLabel(
      detailContext.entity,
      formatRouteLabel(pathname),
    );
    return {
      kind: "detail",
      title: isRecord(detailContext.selected_record)
        ? recordDisplayName(detailContext.selected_record, entityLabel)
        : formatRouteLabel(pathname),
      meta: `${entityLabel} detail`,
      iconKey: contextIconKey(pathname, detailContext.entity),
    };
  }

  const currentList = context?.readables.find((readable) => {
    const value = readable.value as
      | {
          route?: unknown;
          visible_rows?: unknown[];
          filtered_total?: unknown;
          entity?: unknown;
        }
      | undefined;
    return (
      typeof value?.route === "string" &&
      value.route === pathname &&
      Array.isArray(value.visible_rows)
    );
  })?.value as
    | { visible_rows?: unknown[]; filtered_total?: unknown; entity?: unknown }
    | undefined;

  if (currentList?.visible_rows) {
    const visibleCount = currentList.visible_rows.length;
    const total =
      typeof currentList.filtered_total === "number" &&
      currentList.filtered_total !== visibleCount
        ? currentList.filtered_total
        : null;
    const countText = total ? `${visibleCount} of ${total}` : `${visibleCount}`;
    return {
      kind: "list",
      title: formatEntityLabel(currentList.entity, formatRouteLabel(pathname)),
      meta: `List page - ${countText} visible`,
      iconKey: contextIconKey(pathname, currentList.entity),
    };
  }

  return {
    kind: "page",
    title: formatRouteLabel(pathname),
    meta: "Current page",
    iconKey: contextIconKey(pathname),
  };
}

function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();
  return (
    <div
      ref={context.scrollRef}
      style={{ width: "100%", height: "100%" }}
      className={props.className}
    >
      <div ref={context.contentRef} className={props.contentClassName}>
        {props.content}
      </div>

      {props.footer}
    </div>
  );
}

function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button
      variant="outline"
      className={props.className}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="w-4 h-4" />
      <span>Scroll to bottom</span>
    </Button>
  );
}

function AmsAssistantMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Sparkles size={Math.max(16, Math.round(size * 0.58))} strokeWidth={2} />
    </span>
  );
}

export function Thread() {
  const [threadId, setThreadId] = useQueryState("threadId");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );
  const [hideToolCalls, setHideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );
  const [input, setInput] = useState("");
  const [contextChip, setContextChip] = useState<ContextChipState | null>(null);
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");

  const stream = useStreamContext();
  const messages = stream.messages;
  const renderableMessages = getRenderableChatMessages(messages);
  const isLoading = stream.isLoading;
  const todos = useMemo(() => stream.values.todos ?? [], [stream.values.todos]);
  const hasVisibleTodo = todos.some((todo) => String(todo.status) !== "completed");
  const showContextChip = Boolean(contextChip && !hasVisibleTodo);

  const lastError = useRef<string | undefined>(undefined);
  const pendingVoiceCommandRef = useRef<VoiceCommand | null>(null);
  const pendingQuickMessageRef = useRef<string | null>(null);
  const handledVoiceCommandIdsRef = useRef(new Set<string>());

  const handleStartNewThread = useCallback(() => {
    pendingQuickMessageRef.current = null;
    pendingVoiceCommandRef.current = null;
    handledVoiceCommandIdsRef.current.clear();
    prevMessageLength.current = 0;
    announcedAssistantMessageIds.current.clear();
    setInput("");
    setFirstTokenReceived(false);
    setShowTodos(false);
    startNewThread(stream.resetThread);
  }, [stream.resetThread]);

  useEffect(() => {
    let mounted = true;
    copilotBridge.getFreshContext().then((context) => {
      if (mounted) {
        setContextChip(deriveContextChip(context));
      }
    });

    const onContextUpdate = (event: Event) => {
      const context = (event as CustomEvent<PageContext>).detail;
      setContextChip(deriveContextChip(context));
    };

    window.addEventListener(COPILOT_CONTEXT_EVENT, onContextUpdate);
    return () => {
      mounted = false;
      window.removeEventListener(COPILOT_CONTEXT_EVENT, onContextUpdate);
    };
  }, []);

  useEffect(() => {
    if (!stream.error) {
      lastError.current = undefined;
      return;
    }
    try {
      const message = (stream.error as any).message;
      if (!message || lastError.current === message) {
        // Message has already been logged. do not modify ref, return early.
        return;
      }

      // Message is defined, and it has not been logged yet. Save it, and send the error
      lastError.current = message;
      toast.error("An error occurred. Please try again.", {
        description: (
          <p>
            <strong>Error:</strong> <code>{message}</code>
          </p>
        ),
        richColors: true,
        closeButton: true,
      });
    } catch {
      // no-op
    }
  }, [stream.error]);

  useEffect(() => {
    if (!hasVisibleTodo) {
      setShowTodos(false);
    }
  }, [hasVisibleTodo]);

  useEffect(() => {
    notifyParentAssistantLoading(isLoading);
  }, [isLoading]);

  useEffect(() => {
    notifyParentTodoState(todos);
  }, [todos]);

  // TODO: this should be part of the useStream hook
  const prevMessageLength = useRef(0);
  const announcedAssistantMessageIds = useRef(new Set<string>());
  useEffect(() => {
    if (
      messages.length !== prevMessageLength.current &&
      messages?.length &&
      messages[messages.length - 1].type === "ai"
    ) {
      setFirstTokenReceived(true);
    }

    prevMessageLength.current = messages.length;
  }, [messages]);

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest || latest.type !== "ai" || !latest.id) return;
    if (announcedAssistantMessageIds.current.has(latest.id)) return;

    const contentString = getContentString(latest.content ?? []);
    if (!contentString.trim() || contentString.trim() === NO_PROACTIVE_RESPONSE) return;

    announcedAssistantMessageIds.current.add(latest.id);
    notifyParentAssistantMessage(latest.id, contentString);
  }, [messages]);

  const submitUserText = useCallback(async (
    text: string,
    options: { hidden?: boolean } = {},
  ) => {
    const trimmed = text.trim();
    if (!trimmed || stream.isLoading) return;
    setFirstTokenReceived(false);

    const newHumanMessage: Message = {
      id: `${options.hidden ? DO_NOT_RENDER_ID_PREFIX : ""}${uuidv4()}`,
      type: "human",
      content: trimmed,
    };
    if (!options.hidden) {
      notifyParentHumanMessage(newHumanMessage.id, trimmed);
    }

    const toolMessages = ensureToolCallsHaveResponses(stream.messages);
    const pageContext = await copilotBridge.getFreshContext({
      timeoutMs: 5000,
      requireFresh: true,
    });

    stream.submit(
      { messages: [...toolMessages, newHumanMessage] },
      {
        ...RESILIENT_STREAM_OPTIONS,
        // "custom" is required so dispatchCustomEvent() from tools reaches
        // the client (used for frontend-action plumbing).
        streamMode: ["values", "custom"],
        // Per-invocation context. Read on the agent side by
        // dynamicSystemPromptMiddleware. Not stored in messages, not echoed to UI.
        config: buildAgentRunConfig(pageContext),
        optimisticValues: (prev) => ({
          ...prev,
          messages: [
            ...(prev.messages ?? []),
            ...toolMessages,
            newHumanMessage,
          ],
        }),
      },
    );
  }, [stream]);

  const submitVoiceCommand = useCallback(async (command: VoiceCommand) => {
    await submitUserText(buildVoiceCommandPrompt(command.text), {
      hidden: true,
    });
  }, [submitUserText]);

  useEffect(() => {
    const onVoiceCommand = (event: Event) => {
      const command = (event as CustomEvent<VoiceCommand>).detail;
      if (!command?.id || handledVoiceCommandIdsRef.current.has(command.id)) return;
      handledVoiceCommandIdsRef.current.add(command.id);

      if (stream.isLoading) {
        pendingVoiceCommandRef.current = command;
        return;
      }

      void submitVoiceCommand(command);
    };

    window.addEventListener(COPILOT_VOICE_COMMAND_EVENT, onVoiceCommand);
    return () => {
      window.removeEventListener(COPILOT_VOICE_COMMAND_EVENT, onVoiceCommand);
    };
  }, [stream.isLoading, submitVoiceCommand]);

  useEffect(() => {
    if (stream.isLoading || !pendingVoiceCommandRef.current) return;
    const command = pendingVoiceCommandRef.current;
    pendingVoiceCommandRef.current = null;
    void submitVoiceCommand(command);
  }, [stream.isLoading, submitVoiceCommand]);

  useEffect(() => {
    const onParentMessage = (event: MessageEvent) => {
      if (event.data?.source !== "ams-copilot") return;
      if (event.data?.type === "START_NEW_THREAD") {
        handleStartNewThread();
        return;
      }
      if (event.data?.type === "QUICK_MESSAGE") {
        const text = typeof event.data.text === "string" ? event.data.text.trim() : "";
        if (!text) return;
        if (stream.isLoading || !stream.embeddedThreadReady) {
          pendingQuickMessageRef.current = text;
          return;
        }
        void submitUserText(text);
        return;
      }
      if (event.data?.type === "STOP_RUN") {
        // Clear any queued messages from the detached composer or voice
        // command so they do NOT auto-submit the moment the stream finishes
        // winding down — that would silently start a new run right after
        // the user explicitly asked to stop, which re-locks the parent's
        // detached composer and traps the user in a "stuck pending" state.
        pendingQuickMessageRef.current = null;
        pendingVoiceCommandRef.current = null;
        stream.stop();
        return;
      }
      if (event.data?.type === "SET_HIDE_TOOL_CALLS") {
        setHideToolCalls(Boolean(event.data.value));
      }
    };

    window.addEventListener("message", onParentMessage);
    return () => {
      window.removeEventListener("message", onParentMessage);
    };
  }, [handleStartNewThread, stream.embeddedThreadReady, stream.isLoading, submitUserText]);

  useEffect(() => {
    if (
      stream.isLoading ||
      !stream.embeddedThreadReady ||
      !pendingQuickMessageRef.current
    ) {
      return;
    }
    const text = pendingQuickMessageRef.current;
    pendingQuickMessageRef.current = null;
    void submitUserText(text);
  }, [stream.embeddedThreadReady, stream.isLoading, submitUserText]);

  useEffect(() => {
    if (!stream.embeddedThreadReady) return;
    notifyParentReady(threadId ?? null);
  }, [stream.embeddedThreadReady, threadId]);

  useEffect(() => {
    notifyParentHitlInterrupt(stream.interrupt?.value);
  }, [stream.interrupt?.value]);

  useEffect(() => {
    const onHitlDecision = async (event: Event) => {
      const detail = (event as CustomEvent<HitlDecision>).detail ?? {} as HitlDecision;
      const { decision, reason } = detail;
      if (decision !== "approve" && decision !== "reject") return;
      if (stream.isLoading) return;
      if (!isHitlInterruptSchema(stream.interrupt?.value)) return;

      const pageContext = await copilotBridge.getFreshContext({
        timeoutMs: 5000,
        requireFresh: true,
      });
      stream.submit(
        {},
        {
          ...RESILIENT_STREAM_OPTIONS,
          command: {
            resume: buildHitlResume(stream.interrupt.value, decision, reason),
          },
          config: buildAgentRunConfig(pageContext),
          streamMode: ["values", "custom"],
        },
      );
    };

    window.addEventListener(COPILOT_HITL_DECISION_EVENT, onHitlDecision);
    return () => {
      window.removeEventListener(COPILOT_HITL_DECISION_EVENT, onHitlDecision);
    };
  }, [stream]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    await submitUserText(input);

    setInput("");
  };

  const handleVoiceCaptureRequest = useCallback(() => {
    const requested = copilotBridge.requestVoiceCapture();
    if (!requested) {
      toast.info("Voice is available from the AMS page.");
    }
  }, []);

  const handleRegenerate = async (
    parentCheckpoint: Checkpoint | null | undefined,
  ) => {
    // Do this so the loading state is correct
    prevMessageLength.current = prevMessageLength.current - 1;
    setFirstTokenReceived(false);
    const pageContext = await copilotBridge.getFreshContext({
      timeoutMs: 5000,
      requireFresh: true,
    });
    stream.submit(undefined, {
      ...RESILIENT_STREAM_OPTIONS,
      checkpoint: parentCheckpoint,
      streamMode: ["values", "custom"],
      config: buildAgentRunConfig(pageContext),
    });
  };

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = !messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );
  const isEmbedded = process.env.NEXT_PUBLIC_EMBEDDED === "true";

  return (
    <div className="flex w-full h-screen overflow-hidden">
      {!isEmbedded && (
        <div className="relative lg:flex hidden">
          <motion.div
            className="absolute h-full border-r bg-white overflow-hidden z-20"
            style={{ width: 300 }}
            animate={
              isLargeScreen
                ? { x: chatHistoryOpen ? 0 : -300 }
                : { x: chatHistoryOpen ? 0 : -300 }
            }
            initial={{ x: -300 }}
            transition={
              isLargeScreen
                ? { type: "spring", stiffness: 300, damping: 30 }
                : { duration: 0 }
            }
          >
            <div className="relative h-full" style={{ width: 300 }}>
              <ThreadHistory />
            </div>
          </motion.div>
        </div>
      )}
      <motion.div
        className={cn(
          "flex-1 flex flex-col min-w-0 overflow-hidden relative",
          !chatStarted && "grid-rows-[1fr]",
        )}
        layout={isLargeScreen}
        animate={{
          marginLeft: chatHistoryOpen ? (isLargeScreen ? 300 : 0) : 0,
          width: chatHistoryOpen
            ? isLargeScreen
              ? "calc(100% - 300px)"
              : "100%"
            : "100%",
        }}
        transition={
          isLargeScreen
            ? { type: "spring", stiffness: 300, damping: 30 }
            : { duration: 0 }
        }
      >
        {!chatStarted && !isEmbedded && (
          <div className="absolute top-0 left-0 w-full flex items-center justify-between gap-3 p-2 pl-4 z-10">
            <div>
              {(!chatHistoryOpen || !isLargeScreen) && (
                <Button
                  className="hover:bg-gray-100"
                  variant="ghost"
                  onClick={() => setChatHistoryOpen((p) => !p)}
                >
                  {chatHistoryOpen ? (
                    <PanelRightOpen className="size-5" />
                  ) : (
                    <PanelRightClose className="size-5" />
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
        {chatStarted && !isEmbedded && (
          <div className="flex items-center justify-between gap-3 p-2 z-10 relative">
            <div className="flex items-center justify-start gap-2 relative">
              <div className="absolute left-0 z-10">
                {(!chatHistoryOpen || !isLargeScreen) && (
                  <Button
                    className="hover:bg-gray-100"
                    variant="ghost"
                    onClick={() => setChatHistoryOpen((p) => !p)}
                  >
                    {chatHistoryOpen ? (
                      <PanelRightOpen className="size-5" />
                    ) : (
                      <PanelRightClose className="size-5" />
                    )}
                  </Button>
                )}
              </div>
              <motion.button
                className="flex gap-2 items-center cursor-pointer"
                onClick={handleStartNewThread}
                animate={{
                  marginLeft: !chatHistoryOpen ? 48 : 0,
                }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 30,
                }}
              >
              <AmsAssistantMark size={32} />
              <span className="text-xl font-semibold tracking-tight">
                  AMS Assistant
                </span>
              </motion.button>
            </div>

            <div className="flex items-center gap-4">
              <TooltipIconButton
                size="lg"
                className="p-4"
                tooltip="New thread"
                variant="ghost"
                onClick={handleStartNewThread}
              >
                <SquarePen className="size-5" />
              </TooltipIconButton>
            </div>

            <div className="absolute inset-x-0 top-full h-5 bg-gradient-to-b from-background to-background/0" />
          </div>
        )}
        <StickToBottom className="relative flex-1 overflow-hidden">
          <StickyToBottomContent
            className={cn(
              "absolute pl-4 pr-[18px] top-0 left-0 right-0 bottom-[64px] overflow-y-auto [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-track]:my-3",
              "grid grid-rows-[1fr_auto]",
            )}
            contentClassName="pt-8 pb-16 max-w-3xl mx-auto flex flex-col gap-4 w-full min-w-0"
            content={
              <>
                {renderableMessages
                  .map((message, index) =>
                    message.type === "human" ? (
                      <HumanMessage
                        key={message.id || `${message.type}-${index}`}
                        message={message}
                        isLoading={isLoading}
                      />
                    ) : (
                      <AssistantMessage
                        key={message.id || `${message.type}-${index}`}
                        message={message}
                        isLoading={isLoading}
                        handleRegenerate={handleRegenerate}
                      />
                    ),
                  )}
                {/* Special rendering case where there are no AI/tool messages, but there is an interrupt.
                    We need to render it outside of the messages list, since there are no messages to render */}
                {hasNoAIOrToolMessages && !!stream.interrupt && (
                  <AssistantMessage
                    key="interrupt-msg"
                    message={undefined}
                    isLoading={isLoading}
                    handleRegenerate={handleRegenerate}
                  />
                )}
                {isLoading && !firstTokenReceived && (
                  <AssistantMessageLoading />
                )}
              </>
            }
            footer={
              <div className="sticky flex flex-col items-center gap-4 bottom-0 bg-white px-0 pr-[2px] pb-5">
                {!chatStarted && !isEmbedded && (
                  <div className="flex gap-3 items-center">
                    <AmsAssistantMark size={32} />
                    <h1 className="text-2xl font-semibold tracking-tight">
                      AMS Assistant
                    </h1>
                  </div>
                )}

                <ScrollToBottom className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 animate-in fade-in-0 zoom-in-95" />

                <div className="w-full max-w-3xl min-w-0 mx-auto relative z-10">
                  {showContextChip ? (
                    <div
                      className={`ams-context-chip is-${contextChip!.kind}`}
                      aria-label="Current AI context"
                    >
                      <span className="ams-context-chip-icon" aria-hidden="true">
                        <ContextChipIcon iconKey={contextChip!.iconKey} />
                      </span>
                      <span className="ams-context-chip-copy">
                        <span className="ams-context-chip-text">{contextChip!.title}</span>
                        {contextChip!.meta ? (
                          <span className="ams-context-chip-meta">{contextChip!.meta}</span>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                <div className="ams-chat-input-box bg-background border w-full min-w-0 max-w-full overflow-hidden rounded-[18px]">
                  {hasVisibleTodo ? (
                    <TodosPanel
                      todos={todos}
                      expanded={showTodos}
                      onExpandedChange={setShowTodos}
                      attached
                    />
                  ) : null}
                  <form
                    onSubmit={handleSubmit}
                    className="grid min-w-0 grid-rows-[1fr_auto] gap-1 max-w-3xl mx-auto"
                  >
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.metaKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          const el = e.target as HTMLElement | undefined;
                          const form = el?.closest("form");
                          form?.requestSubmit();
                        }
                      }}
                      placeholder="Type your message..."
                      className="px-3 pt-3 pb-0 min-h-[52px] border-none bg-transparent field-sizing-content shadow-none ring-0 outline-none focus:outline-none focus:ring-0 resize-none overflow-y-auto break-words text-sm"
                    />

                    <div className="flex items-center justify-between px-2.5 py-2 pt-1">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 rounded-full text-muted-foreground hover:bg-white/70"
                          aria-label="New chat"
                          title="New chat"
                          onClick={handleStartNewThread}
                        >
                          <Plus className="size-4" />
                        </Button>
                        <div className="flex origin-left scale-[0.88] items-center space-x-1.5">
                          <Switch
                            id="render-tool-calls"
                            checked={hideToolCalls ?? false}
                            onCheckedChange={setHideToolCalls}
                          />
                          <Label
                            htmlFor="render-tool-calls"
                            className="text-xs text-gray-600"
                          >
                            Hide Tool Calls
                          </Label>
                        </div>
                      </div>
                      {stream.isLoading ? (
                        <Button
                          key="stop"
                          size="sm"
                          variant="ghost"
                          onClick={() => stream.stop()}
                          className="h-7 rounded-full text-xs px-3 gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <LoaderCircle className="w-3 h-3 animate-spin" />
                          Cancel
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2">
                          {/* mic — matches detached: transparent bg, muted icon, 28 px, 8 px radius */}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7 rounded-[8px] border-0 bg-transparent text-muted-foreground hover:bg-black/5 hover:text-foreground"
                            onClick={handleVoiceCaptureRequest}
                            aria-label="Start voice input"
                            title="Start voice input"
                          >
                            <Mic className="size-3.5" strokeWidth={1.9} />
                          </Button>
                          {/* send — circle, black */}
                          <Button
                            type="submit"
                            size="icon"
                            className="size-[30px] rounded-full border-0 bg-gray-900 text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.35)] transition-all duration-150 hover:bg-black hover:shadow-[0_4px_14px_-2px_rgba(0,0,0,0.4)] active:scale-95 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:cursor-not-allowed"
                            disabled={isLoading || !input.trim()}
                            aria-label="Send message"
                            title="Send message"
                          >
                            <SendHorizontal className="size-3.5" strokeWidth={2} />
                          </Button>
                        </div>
                      )}
                    </div>
                  </form>
                </div>
                </div>
              </div>
            }
          />
        </StickToBottom>
      </motion.div>
    </div>
  );
}
