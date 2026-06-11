import assert from "node:assert/strict";
import test from "node:test";

import { getParallelFrontendToolBlocks } from "./serial-frontend-tool-guard.js";

const searchCall = (id: string, field: string) => ({
  id,
  name: "search_form_options",
  args: { field, query: "" },
});

test("two parallel browser tool calls defer the second with a resumable ToolMessage", () => {
  const blocks = getParallelFrontendToolBlocks([
    { tool_calls: [] },
    {
      tool_calls: [
        searchCall("call_1", "items.0.central_register"),
        searchCall("call_2", "items.0.item"),
      ],
    },
  ]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tool_call_id, "call_2");
  assert.equal(blocks[0].name, "search_form_options");
  // Deferral must NOT look like a failure, so the model resumes instead of
  // stopping or reporting an error to the user.
  assert.notEqual(blocks[0].status, "error");
  assert.match(String(blocks[0].content), /DEFERRED, not failed/);
  assert.match(String(blocks[0].content), /re-issue this exact call/);
  assert.match(String(blocks[0].content), /Do not stop/);
  // The message must teach the model why this happened and not to repeat it.
  assert.match(String(blocks[0].content), /one at a time/i);
  assert.match(String(blocks[0].content), /wait for each result/);
});

test("mixed browser tools defer everything after the first", () => {
  const blocks = getParallelFrontendToolBlocks([
    {
      tool_calls: [
        { id: "call_1", name: "set_form_values", args: { values: {} } },
        { id: "call_2", name: "navigate_to_route", args: { path: "/items" } },
        { id: "call_3", name: "request_form_submit", args: { intent: "submit" } },
      ],
    },
  ]);

  assert.deepEqual(
    blocks.map((message) => message.tool_call_id),
    ["call_2", "call_3"],
  );
  assert.deepEqual(
    blocks.map((message) => message.name),
    ["navigate_to_route", "request_form_submit"],
  );
});

test("a single browser tool call is not deferred", () => {
  const blocks = getParallelFrontendToolBlocks([
    { tool_calls: [searchCall("call_1", "items.0.item")] },
  ]);
  assert.equal(blocks.length, 0);
});

test("a browser tool alongside a local tool is not deferred", () => {
  const blocks = getParallelFrontendToolBlocks([
    {
      tool_calls: [
        searchCall("call_1", "items.0.item"),
        { id: "call_2", name: "resolve_relative_date", args: { phrase: "today" } },
      ],
    },
  ]);
  assert.equal(blocks.length, 0);
});

test("parallel local-only tools are not deferred", () => {
  const blocks = getParallelFrontendToolBlocks([
    {
      tool_calls: [
        { id: "call_1", name: "resolve_relative_date", args: { phrase: "today" } },
        { id: "call_2", name: "write_todos", args: {} },
      ],
    },
  ]);
  assert.equal(blocks.length, 0);
});

test("all seven browser round-trip tools are guarded", () => {
  const names = [
    "navigate_to_route",
    "open_form",
    "set_form_values",
    "search_form_options",
    "request_form_submit",
    "run_frontend_action",
    "get_app_map",
  ];
  for (const name of names) {
    const blocks = getParallelFrontendToolBlocks([
      {
        tool_calls: [
          { id: "call_1", name, args: {} },
          { id: "call_2", name, args: {} },
        ],
      },
    ]);
    assert.equal(blocks.length, 1, `${name} should be guarded`);
    assert.equal(blocks[0].tool_call_id, "call_2");
  }
});

test("messages without tool calls produce no deferrals", () => {
  assert.equal(getParallelFrontendToolBlocks([]).length, 0);
  assert.equal(getParallelFrontendToolBlocks([{}]).length, 0);
  assert.equal(getParallelFrontendToolBlocks([{ tool_calls: [] }]).length, 0);
});

test("serialized kwargs-shaped messages are handled", () => {
  const blocks = getParallelFrontendToolBlocks([
    {
      kwargs: {
        tool_calls: [
          searchCall("call_1", "items.0.central_register"),
          searchCall("call_2", "items.0.item"),
        ],
      },
    },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tool_call_id, "call_2");
});

test("only the last message is inspected", () => {
  const blocks = getParallelFrontendToolBlocks([
    {
      tool_calls: [
        searchCall("old_1", "items.0.item"),
        searchCall("old_2", "items.0.item"),
      ],
    },
    { tool_calls: [searchCall("call_1", "items.0.item")] },
  ]);
  assert.equal(blocks.length, 0);
});
