import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).React = React;

test("todos panel constrains long task content inside its container", async () => {
  const { TodosPanel } = await import("./todos-panel");
  const longTask = "current-task-".repeat(80);
  const html = renderToStaticMarkup(
    <TodosPanel
      todos={[
        {
          id: "todo_1",
          status: "in_progress",
          content: longTask,
        },
      ]}
      expanded
      onExpandedChange={() => {}}
      attached
    />,
  );

  assert.match(html, /min-w-0 max-w-full overflow-hidden/);
  assert.match(html, /overflow-y-auto overflow-x-hidden/);
  assert.match(html, /truncate leading-snug/);
  assert.match(html, /title="current-task-/);
  assert.doesNotMatch(html, /break-all/);
});
