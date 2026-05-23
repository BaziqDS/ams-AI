import assert from "node:assert/strict";
import test from "node:test";

import { TOOLS } from "./tools.js";

test("agent tool registry does not expose direct database-query tools", () => {
  const toolNames = TOOLS.map((tool): string => tool.name);
  const removedPrefix = ["s", "q", "l", "_", "d", "b", "_"].join("");

  assert.equal(toolNames.some((name) => name.startsWith(removedPrefix)), false);
  assert.equal(toolNames.includes(`${removedPrefix}select`), false);
  assert.equal(toolNames.includes(`${removedPrefix}query`), false);
  assert.equal(toolNames.includes(`${removedPrefix}schema`), false);
  assert.equal(toolNames.includes(`${removedPrefix}list_tables`), false);
});

test("agent tool registry does not expose Tavily web search", () => {
  const toolNames = TOOLS.map((tool): string => tool.name);

  assert.doesNotMatch(toolNames.join(","), /tavily/i);
  assert.equal(toolNames.includes("tavily_search"), false);
});

test("agent tool registry exposes get_app_map directly", () => {
  const toolNames = TOOLS.map((tool): string => tool.name);

  assert.equal(toolNames.includes("get_app_map"), true);
});

test("agent tool registry exposes search_form_options directly", () => {
  const toolNames = TOOLS.map((tool): string => tool.name);

  assert.equal(toolNames.includes("search_form_options"), true);
});
