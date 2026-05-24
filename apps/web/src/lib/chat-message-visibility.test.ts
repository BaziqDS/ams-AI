import assert from "node:assert/strict";
import test from "node:test";

import { DO_NOT_RENDER_ID_PREFIX } from "./ensure-tool-responses";
import { getRenderableChatMessages } from "./chat-message-visibility";
import { buildVoiceCommandPrompt } from "./voice-command";

test("hidden voice commands render as the translated transcript", () => {
  const messages = getRenderableChatMessages([
    {
      id: `${DO_NOT_RENDER_ID_PREFIX}voice-1`,
      type: "human",
      content: buildVoiceCommandPrompt("fill the finance stage"),
    },
  ]);

  assert.deepEqual(messages, [
    {
      id: `${DO_NOT_RENDER_ID_PREFIX}voice-1`,
      type: "human",
      content: "Voice: fill the finance stage",
    },
  ]);
});

test("hidden non-voice messages remain hidden", () => {
  const messages = getRenderableChatMessages([
    {
      id: `${DO_NOT_RENDER_ID_PREFIX}internal-1`,
      type: "human",
      content: "internal control message",
    },
    {
      id: "visible-1",
      type: "human",
      content: "normal message",
    },
  ]);

  assert.deepEqual(messages, [
    {
      id: "visible-1",
      type: "human",
      content: "normal message",
    },
  ]);
});

test("system messages are never rendered as chat content", () => {
  const messages = getRenderableChatMessages([
    {
      id: "system-1",
      type: "system",
      content: "internal system prompt",
    },
    {
      id: "visible-1",
      type: "ai",
      content: "visible assistant response",
    },
  ]);

  assert.deepEqual(messages, [
    {
      id: "visible-1",
      type: "ai",
      content: "visible assistant response",
    },
  ]);
});
