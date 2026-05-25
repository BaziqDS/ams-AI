import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).React = React;

test("tool call arguments stay constrained inside the chat panel", async () => {
  const { ToolCalls } = await import("./tool-calls");
  const html = renderToStaticMarkup(
    <ToolCalls
      toolCalls={[
        {
          id: "call_with_a_very_long_identifier_that_should_not_expand_layout",
          name: "set_form_values",
          type: "tool_call",
          args: {
            values: {
              remarks:
                "x".repeat(240) + " " + "another-unbroken-token".repeat(20),
            },
          },
        },
      ]}
    />,
  );

  assert.match(html, /max-w-full min-w-0 overflow-hidden/);
  assert.match(html, /w-full table-fixed/);
  assert.match(html, /break-all whitespace-pre-wrap/);
});

test("todo tool cards wrap long task content inside the chat panel", async () => {
  const { ToolCalls } = await import("./tool-calls");
  const html = renderToStaticMarkup(
    <ToolCalls
      toolCalls={[
        {
          id: "call_todos",
          name: "write_todos",
          type: "tool_call",
          args: {
            todos: [
              {
                id: "todo_1",
                status: "in_progress",
                content: "todo-content-".repeat(80),
              },
            ],
          },
        },
      ]}
    />,
  );

  assert.match(html, /max-w-full min-w-0 overflow-hidden/);
  assert.match(html, /min-w-0 max-w-full/);
  assert.match(html, /break-all/);
});

test("deep agent task calls render as compact subagent cards", async () => {
  const { ToolCalls } = await import("./tool-calls");
  const html = renderToStaticMarkup(
    <ToolCalls
      toolCalls={[
        {
          id: "call_task",
          name: "task",
          type: "tool_call",
          args: {
            subagent_type: "frontend_controller",
            description:
              "Open the inspection form, verify live required fields, resolve department options, fill the user-provided values, and report blockers without guessing.",
          },
        },
      ]}
    />,
  );

  assert.match(html, /Subagent task/);
  assert.match(html, /Frontend controller/);
  assert.match(html, /AMS page action/);
  assert.match(html, /line-clamp-3/);
  assert.match(html, /verify live required fields/);
  assert.doesNotMatch(html, /subagent_type/);
  assert.doesNotMatch(html, /call_task/);
});

test("tool results stay constrained inside the chat panel", async () => {
  const { ToolResult } = await import("./tool-calls");
  const html = renderToStaticMarkup(
    <ToolResult
      message={
        {
          type: "tool",
          name: "set_form_values",
          tool_call_id: "call_with_a_very_long_identifier_that_should_not_expand_layout",
          content: JSON.stringify({
            result:
              "x".repeat(240) + " " + "another-unbroken-token".repeat(20),
          }),
        } as any
      }
    />,
  );

  assert.match(html, /max-w-full min-w-0 overflow-hidden/);
  assert.match(html, /w-full table-fixed/);
  assert.match(html, /break-all whitespace-pre-wrap/);
});
