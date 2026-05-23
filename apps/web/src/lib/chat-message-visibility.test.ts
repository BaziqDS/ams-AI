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
      id: `${DO_NOT_RENDER_ID_PREFIX}repair-1`,
      type: "human",
      content: "OPENUI_RENDERER_REPAIR_REQUEST",
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
