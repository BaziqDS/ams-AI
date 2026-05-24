import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const threadSource = readFileSync(
  join(process.cwd(), "src", "components", "thread", "index.tsx"),
  "utf8",
);

test("visible user messages are mirrored to the detached composer", () => {
  assert.match(threadSource, /function notifyParentHumanMessage/);
  assert.match(threadSource, /type: "HUMAN_MESSAGE"/);
  assert.match(threadSource, /if \(!options\.hidden\) \{/);
  assert.match(threadSource, /notifyParentHumanMessage\(newHumanMessage\.id, trimmed\)/);
});

test("detached composer can stop the active agent run", () => {
  assert.match(threadSource, /event\.data\?\.type === "STOP_RUN"/);
  assert.match(threadSource, /stream\.stop\(\)/);
});
