import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "@langchain/langgraph-sdk";

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

test("pending task text stream is hidden while loading", () => {
  const messages = getRenderableChatMessages(
    [
      {
        id: "task-call",
        type: "ai",
        content: "",
        tool_calls: [
          {
            id: "task-1",
            name: "task",
            type: "tool_call",
            args: {
              subagent_type: "frontend_controller",
              description: "Create the inspection",
            },
          },
        ],
      },
      {
        id: "subagent-text",
        type: "ai",
        content: "PAGE: /inspections/new\nI am filling the form now.",
      },
    ] as unknown as Message[],
    { suppressPendingTaskText: true },
  );

  assert.deepEqual(
    messages.map((message) => message.id),
    ["task-call"],
  );
});

test("task result and final orchestrator response render after the task resolves", () => {
  const messages = getRenderableChatMessages(
    [
      {
        id: "task-call",
        type: "ai",
        content: "",
        tool_calls: [
          {
            id: "task-1",
            name: "task",
            type: "tool_call",
            args: {
              subagent_type: "frontend_controller",
              description: "Create the inspection",
            },
          },
        ],
      },
      {
        id: "subagent-text",
        type: "ai",
        content: "PAGE: /inspections/new\nI submitted the form.",
      },
      {
        id: "task-result",
        type: "tool",
        name: "task",
        tool_call_id: "task-1",
        content: "PAGE: /inspections/2; lastSubmitResult: ok",
      },
      {
        id: "final-openui",
        type: "ai",
        content: 'root = Card(TextContent("Inspection created."))',
      },
    ] as unknown as Message[],
    { suppressPendingTaskText: true },
  );

  assert.deepEqual(
    messages.map((message) => message.id),
    ["task-call", "task-result", "final-openui"],
  );
});

test("tool calls still render while a task is pending", () => {
  const messages = getRenderableChatMessages(
    [
      {
        id: "task-call",
        type: "ai",
        content: "",
        tool_calls: [
          {
            id: "task-1",
            name: "task",
            type: "tool_call",
            args: {
              subagent_type: "frontend_controller",
              description: "Create the inspection",
            },
          },
        ],
      },
      {
        id: "subagent-tool-call",
        type: "ai",
        content: "I will set the form values now.",
        tool_calls: [
          {
            id: "set-values-1",
            name: "set_form_values",
            type: "tool_call",
            args: {
              values: {
                contract_number: "CN-1",
              },
            },
          },
        ],
      },
    ] as unknown as Message[],
    { suppressPendingTaskText: true },
  );

  assert.deepEqual(
    messages.map((message) => message.id),
    ["task-call", "subagent-tool-call"],
  );
  assert.equal(messages[1]?.content, "");
});

test("pending task text stream renders when suppression is disabled", () => {
  const messages = getRenderableChatMessages([
    {
      id: "task-call",
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "task-1",
          name: "task",
          type: "tool_call",
          args: {
            subagent_type: "frontend_controller",
            description: "Create the inspection",
          },
        },
      ],
    },
    {
      id: "subagent-text",
      type: "ai",
      content: "PAGE: /inspections/new\nI am filling the form now.",
    },
  ] as unknown as Message[]);

  assert.deepEqual(
    messages.map((message) => message.id),
    ["task-call", "subagent-text"],
  );
});
