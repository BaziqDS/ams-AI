import assert from "node:assert/strict";
import test from "node:test";

import { getParallelTaskBlocks } from "./serial-task-guard.js";

const frontendTask = (id: string) => ({
  id,
  name: "task",
  args: { description: "do frontend work", subagent_type: "frontend_controller" },
});

const sqlTask = (id: string) => ({
  id,
  name: "task",
  args: { description: "run a report", subagent_type: "sql_analyst" },
});

test("two parallel frontend tasks defer the second with a resumable ToolMessage", () => {
  const blocks = getParallelTaskBlocks([
    { tool_calls: [] },
    { tool_calls: [frontendTask("call_1"), frontendTask("call_2")] },
  ]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tool_call_id, "call_2");
  assert.equal(blocks[0].name, "task");
  // Deferral must NOT look like a failure, so the model resumes instead of
  // stopping or reporting an error to the user.
  assert.notEqual(blocks[0].status, "error");
  assert.match(String(blocks[0].content), /DEFERRED, not failed/);
  assert.match(String(blocks[0].content), /re-issue this exact delegation/);
  assert.match(String(blocks[0].content), /Do not stop/);
  // The message must teach the model why this happened and not to repeat it.
  assert.match(String(blocks[0].content), /only one frontend_controller task can drive/);
  assert.match(String(blocks[0].content), /ONE AT A TIME/);
  assert.match(String(blocks[0].content), /wait for each task result/);
});

test("three parallel frontend tasks defer all but the first", () => {
  const blocks = getParallelTaskBlocks([
    {
      tool_calls: [
        frontendTask("call_1"),
        frontendTask("call_2"),
        frontendTask("call_3"),
      ],
    },
  ]);

  assert.deepEqual(
    blocks.map((message) => message.tool_call_id),
    ["call_2", "call_3"],
  );
});

test("a single frontend task is not deferred", () => {
  const blocks = getParallelTaskBlocks([
    { tool_calls: [frontendTask("call_1")] },
  ]);
  assert.equal(blocks.length, 0);
});

test("parallel sql_analyst tasks are not deferred", () => {
  const blocks = getParallelTaskBlocks([
    { tool_calls: [sqlTask("call_1"), sqlTask("call_2")] },
  ]);
  assert.equal(blocks.length, 0);
});

test("a frontend task in parallel with a sql task is not deferred", () => {
  const blocks = getParallelTaskBlocks([
    { tool_calls: [sqlTask("call_1"), frontendTask("call_2")] },
  ]);
  assert.equal(blocks.length, 0);
});

test("mixed parallel calls defer only the extra frontend task", () => {
  const blocks = getParallelTaskBlocks([
    {
      tool_calls: [
        sqlTask("call_1"),
        frontendTask("call_2"),
        frontendTask("call_3"),
      ],
    },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tool_call_id, "call_3");
});

test("a frontend task alongside a non-task tool call is not deferred", () => {
  const blocks = getParallelTaskBlocks([
    {
      tool_calls: [
        frontendTask("call_1"),
        { id: "call_2", name: "write_todos", args: {} },
      ],
    },
  ]);
  assert.equal(blocks.length, 0);
});

test("messages without tool calls produce no deferrals", () => {
  assert.equal(getParallelTaskBlocks([]).length, 0);
  assert.equal(getParallelTaskBlocks([{}]).length, 0);
  assert.equal(getParallelTaskBlocks([{ tool_calls: [] }]).length, 0);
});

test("JSON-string args are handled", () => {
  const blocks = getParallelTaskBlocks([
    {
      tool_calls: [
        {
          id: "call_1",
          name: "task",
          args: JSON.stringify({ subagent_type: "frontend_controller" }),
        },
        {
          id: "call_2",
          name: "task",
          args: JSON.stringify({ subagent_type: "frontend_controller" }),
        },
      ],
    },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tool_call_id, "call_2");
});

test("serialized kwargs-shaped messages are handled", () => {
  const blocks = getParallelTaskBlocks([
    { kwargs: { tool_calls: [frontendTask("call_1"), frontendTask("call_2")] } },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].tool_call_id, "call_2");
});

test("only the last message is inspected", () => {
  const blocks = getParallelTaskBlocks([
    { tool_calls: [frontendTask("old_1"), frontendTask("old_2")] },
    { tool_calls: [frontendTask("call_1")] },
  ]);
  assert.equal(blocks.length, 0);
});
