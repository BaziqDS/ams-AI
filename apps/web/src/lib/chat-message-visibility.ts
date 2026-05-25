import type { Message } from "@langchain/langgraph-sdk";

import { DO_NOT_RENDER_ID_PREFIX } from "./ensure-tool-responses";
import { getVoiceCommandDisplayText } from "./voice-command";

function contentToText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => {
      return Boolean(part) && part.type === "text" && typeof part.text === "string";
    })
    .map((part) => part.text)
    .join(" ");
}

type RenderableChatMessageOptions = {
  suppressPendingTaskText?: boolean;
};

type MessageToolCall = {
  id?: string;
  name?: string;
};

type MessageWithToolCalls = Message & {
  tool_calls?: MessageToolCall[];
};

type MessageWithToolResult = Message & {
  name?: string;
  tool_call_id?: string;
};

function getToolCalls(message: Message): MessageToolCall[] {
  if (message.type !== "ai") return [];
  const toolCalls = (message as MessageWithToolCalls).tool_calls;
  return Array.isArray(toolCalls) ? toolCalls : [];
}

function hasToolCalls(message: Message): boolean {
  return getToolCalls(message).length > 0;
}

function hasVisibleAiText(message: Message): boolean {
  return (
    message.type === "ai" &&
    contentToText(message.content).trim().length > 0
  );
}

function withoutVisibleAiText(message: Message): Message {
  if (message.type !== "ai") return message;
  if (typeof message.content === "string") {
    return {
      ...message,
      content: "",
    };
  }
  return {
    ...message,
    content: message.content.filter((part) => part?.type !== "text"),
  };
}

export function getRenderableChatMessage(message: Message): Message | null {
  if (message.type === "system") return null;
  if (!message.id?.startsWith(DO_NOT_RENDER_ID_PREFIX)) return message;
  if (message.type !== "human") return null;

  const displayText = getVoiceCommandDisplayText(contentToText(message.content));
  if (!displayText) return null;

  return {
    ...message,
    content: displayText,
  };
}

export function getRenderableChatMessages(
  messages: Message[],
  options: RenderableChatMessageOptions = {},
): Message[] {
  if (!options.suppressPendingTaskText) {
    return messages
      .map(getRenderableChatMessage)
      .filter((message): message is Message => Boolean(message));
  }

  const renderableMessages: Message[] = [];
  const pendingTaskToolCallIds = new Set<string>();
  let pendingAnonymousTaskToolCalls = 0;

  for (const message of messages) {
    const hasPendingTask =
      pendingTaskToolCallIds.size > 0 || pendingAnonymousTaskToolCalls > 0;

    if (
      !(hasPendingTask && hasVisibleAiText(message) && !hasToolCalls(message))
    ) {
      const messageToRender =
        hasPendingTask && hasVisibleAiText(message)
          ? withoutVisibleAiText(message)
          : message;
      const renderableMessage = getRenderableChatMessage(messageToRender);
      if (renderableMessage) renderableMessages.push(renderableMessage);
    }

    for (const toolCall of getToolCalls(message)) {
      if (toolCall.name !== "task") continue;
      if (typeof toolCall.id === "string" && toolCall.id) {
        pendingTaskToolCallIds.add(toolCall.id);
      } else {
        pendingAnonymousTaskToolCalls += 1;
      }
    }

    if (message.type === "tool") {
      const toolResult = message as MessageWithToolResult;
      const toolCallId = toolResult.tool_call_id;
      if (typeof toolCallId === "string" && pendingTaskToolCallIds.delete(toolCallId)) {
        continue;
      }
      if (toolResult.name === "task" && pendingAnonymousTaskToolCalls > 0) {
        pendingAnonymousTaskToolCalls -= 1;
      }
    }
  }

  return renderableMessages;
}
