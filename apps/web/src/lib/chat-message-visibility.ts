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

export function getRenderableChatMessage(message: Message): Message | null {
  if (!message.id?.startsWith(DO_NOT_RENDER_ID_PREFIX)) return message;
  if (message.type !== "human") return null;

  const displayText = getVoiceCommandDisplayText(contentToText(message.content));
  if (!displayText) return null;

  return {
    ...message,
    content: displayText,
  };
}

export function getRenderableChatMessages(messages: Message[]): Message[] {
  return messages
    .map(getRenderableChatMessage)
    .filter((message): message is Message => Boolean(message));
}
