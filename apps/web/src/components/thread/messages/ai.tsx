import { parsePartialJson } from "@langchain/core/output_parsers";
import { v4 as uuidv4 } from "uuid";
import type { ActionEvent } from "@openuidev/react-lang";
import { useStreamContext } from "@/providers/Stream";
import { AIMessage, Checkpoint, Message } from "@langchain/langgraph-sdk";
import { getContentString } from "../utils";
import { BranchSwitcher, CommandBar } from "./shared";
import { MarkdownText } from "../markdown-text";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import { cn } from "@/lib/utils";
import { ToolCalls, ToolResult } from "./tool-calls";
import { MessageContentComplex } from "@langchain/core/messages";
import { Fragment } from "react/jsx-runtime";
import { isAgentInboxInterruptSchema } from "@/lib/agent-inbox-interrupt";
import { ThreadView } from "../agent-inbox";
import { useQueryState, parseAsBoolean } from "nuqs";
import { GenericInterruptView } from "./generic-interrupt";
import { HitlInterruptView } from "./hitl-interrupt";
import { isHitlInterruptSchema } from "@/lib/hitl-interrupt";
import { FrontendActionInterruptView } from "./frontend-action-interrupt";
import { isFrontendActionInterruptSchema } from "@/lib/frontend-action-interrupt";
import {
  getOpenUiLang,
  OpenUiAssistantMessage,
} from "../openui-message";
import { ensureToolCallsHaveResponses } from "@/lib/ensure-tool-responses";
import { copilotBridge } from "@/lib/copilot-bridge";
import { isAmsRelativeRoute } from "@/lib/ams-route";

function CustomComponent({
  message,
  thread,
}: {
  message: Message;
  thread: ReturnType<typeof useStreamContext>;
}) {
  const { values } = useStreamContext();
  const customComponents = values.ui?.filter(
    (ui) => ui.metadata?.message_id === message.id,
  );

  if (!customComponents?.length) return null;
  return (
    <Fragment key={message.id}>
      {customComponents.map((customComponent) => (
        <LoadExternalComponent
          key={customComponent.id}
          stream={thread}
          message={customComponent}
          meta={{ ui: customComponent }}
        />
      ))}
    </Fragment>
  );
}

function parseAnthropicStreamedToolCalls(
  content: MessageContentComplex[],
): AIMessage["tool_calls"] {
  const toolCallContents = content.filter((c) => c.type === "tool_use" && c.id);

  return toolCallContents.map((tc) => {
    const toolCall = tc as Record<string, any>;
    let json: Record<string, any> = {};
    if (toolCall?.input) {
      try {
        json = parsePartialJson(toolCall.input) ?? {};
      } catch {
        // Pass
      }
    }
    return {
      name: toolCall.name ?? "",
      id: toolCall.id ?? "",
      args: json,
      type: "tool_call",
    };
  });
}

export function AssistantMessage({
  message,
  isLoading,
  handleRegenerate,
}: {
  message: Message | undefined;
  isLoading: boolean;
  handleRegenerate: (parentCheckpoint: Checkpoint | null | undefined) => void;
}) {
  const content = message?.content ?? [];
  const contentString = getContentString(content);
  const [hideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );

  const thread = useStreamContext();
  const isLastMessage =
    thread.messages[thread.messages.length - 1].id === message?.id;
  const hasNoAIOrToolMessages = !thread.messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );
  const meta = message ? thread.getMessagesMetadata(message) : undefined;
  const threadInterrupt = thread.interrupt;

  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
  const anthropicStreamedToolCalls = Array.isArray(content)
    ? parseAnthropicStreamedToolCalls(content)
    : undefined;
  const openUiCode = getOpenUiLang(contentString);

  const hasToolCalls =
    message &&
    "tool_calls" in message &&
    message.tool_calls &&
    message.tool_calls.length > 0;
  const toolCallsHaveContents =
    hasToolCalls &&
    message.tool_calls?.some(
      (tc) => tc.args && Object.keys(tc.args).length > 0,
    );
  const hasAnthropicToolCalls = !!anthropicStreamedToolCalls?.length;
  const isToolResult = message?.type === "tool";

  const handleOpenUiAction = async (event: ActionEvent) => {
    const action = event as ActionEvent & {
      humanFriendlyMessage?: string;
      message?: string;
      params?: { url?: string; message?: string };
      formState?: Record<string, unknown>;
    };

    if (action.type === "open_url" && action.params?.url) {
      if (isAmsRelativeRoute(action.params.url)) {
        copilotBridge
          .callAction("navigate_to_route", { path: action.params.url })
          .catch((error) => {
            console.warn("[copilot/openui] navigation failed:", error);
          });
        return;
      }
      window.open(action.params.url, "_blank", "noopener,noreferrer");
      return;
    }

    let nextMessage =
      action.humanFriendlyMessage || action.params?.message || action.message;

    if (action.formState && Object.keys(action.formState).length > 0) {
      const unwrap = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        if (v instanceof Date) return v.toISOString().split("T")[0];
        if (typeof v === "object" && v !== null && "value" in v) return unwrap((v as Record<string, unknown>).value);
        if (typeof v === "object" && v !== null) {
          const entries = Object.entries(v as Record<string, unknown>);
          if (entries.every(([, val]) => typeof val === "boolean")) {
            return entries.filter(([, val]) => val).map(([k]) => k).join(", ") || "(none)";
          }
          return entries.map(([k, val]) => `${k}: ${unwrap(val)}`).join(", ");
        }
        return String(v);
      };

      const flatFields: [string, string][] = [];
      for (const [key, val] of Object.entries(action.formState)) {
        if (typeof val === "object" && val !== null && !("value" in val) && !Array.isArray(val) && !(val instanceof Date)) {
          for (const [field, fieldVal] of Object.entries(val as Record<string, unknown>)) {
            flatFields.push([field, unwrap(fieldVal)]);
          }
        } else {
          flatFields.push([key, unwrap(val)]);
        }
      }

      const formData = flatFields
        .filter(([, v]) => v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      nextMessage = nextMessage
        ? `${nextMessage}\n\nForm data:\n${formData}`
        : `Form submitted:\n${formData}`;
    }

    if (!nextMessage?.trim() || thread.isLoading) return;

    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: nextMessage,
    };

    const toolMessages = ensureToolCallsHaveResponses(thread.messages);
    const pageContext = await copilotBridge.getFreshContext();
    thread.submit(
      { messages: [...toolMessages, newHumanMessage] },
      {
        streamMode: ["values", "custom"],
        config: {
          configurable: {
            pageContext,
          },
        },
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
  };

  if (isToolResult && hideToolCalls) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-start mr-auto gap-2 group",
        openUiCode && !isToolResult && "w-full min-w-0",
      )}
    >
      {isToolResult ? (
        <ToolResult message={message} />
      ) : (
        <div
          className={cn(
            "flex flex-col gap-2",
            openUiCode && "w-full min-w-0",
          )}
        >
          {openUiCode ? (
            <OpenUiAssistantMessage
              code={openUiCode}
              fallback={
                <div className="py-1">
                  <MarkdownText>{contentString}</MarkdownText>
                </div>
              }
              isStreaming={isLoading && isLastMessage}
              onAction={handleOpenUiAction}
            />
          ) : contentString.length > 0 ? (
            <div className="py-1">
              <MarkdownText>{contentString}</MarkdownText>
            </div>
          ) : null}

          {!hideToolCalls && (
            <>
              {(hasToolCalls && toolCallsHaveContents && (
                <ToolCalls toolCalls={message.tool_calls} />
              )) ||
                (hasAnthropicToolCalls && (
                  <ToolCalls toolCalls={anthropicStreamedToolCalls} />
                )) ||
                (hasToolCalls && <ToolCalls toolCalls={message.tool_calls} />)}
            </>
          )}

          {message && <CustomComponent message={message} thread={thread} />}
          {isAgentInboxInterruptSchema(threadInterrupt?.value) &&
            (isLastMessage || hasNoAIOrToolMessages) && (
              <ThreadView interrupt={threadInterrupt.value} />
            )}
          {isHitlInterruptSchema(threadInterrupt?.value) &&
            (isLastMessage || hasNoAIOrToolMessages) && (
              <HitlInterruptView interrupt={threadInterrupt.value} />
            )}
          {isFrontendActionInterruptSchema(threadInterrupt?.value) &&
            (isLastMessage || hasNoAIOrToolMessages) && (
              <FrontendActionInterruptView interrupt={threadInterrupt.value} />
            )}
          {threadInterrupt?.value &&
          !isAgentInboxInterruptSchema(threadInterrupt.value) &&
          !isHitlInterruptSchema(threadInterrupt.value) &&
          !isFrontendActionInterruptSchema(threadInterrupt.value) &&
          isLastMessage ? (
            <GenericInterruptView interrupt={threadInterrupt.value} />
          ) : null}
          <div
            className={cn(
              "flex gap-2 items-center mr-auto transition-opacity",
              "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
            )}
          >
            <BranchSwitcher
              branch={meta?.branch}
              branchOptions={meta?.branchOptions}
              onSelect={(branch) => thread.setBranch(branch)}
              isLoading={isLoading}
            />
            <CommandBar
              content={contentString}
              isLoading={isLoading}
              isAiMessage={true}
              handleRegenerate={() => handleRegenerate(parentCheckpoint)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function AssistantMessageLoading() {
  return (
    <div className="flex items-start mr-auto gap-2">
      <div className="flex items-center gap-1 rounded-2xl bg-muted px-4 py-2 h-8">
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/50 animate-[pulse_1.5s_ease-in-out_infinite]"></div>
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/50 animate-[pulse_1.5s_ease-in-out_0.5s_infinite]"></div>
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/50 animate-[pulse_1.5s_ease-in-out_1s_infinite]"></div>
      </div>
    </div>
  );
}
