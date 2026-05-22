import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOLS,
  filterInspectableSqlTables,
  formatHiddenSqlTablesWarning,
} from "./tools.js";

test("filters internal SQL tables out of assistant table discovery", () => {
  const result = filterInspectableSqlTables([
    "inventory_item",
    "inventory_inspectioncertificate",
    "auth_user",
    "django_session",
    "silk_request",
    "token_blacklist_outstandingtoken",
  ]);

  assert.deepEqual(result.visible, [
    "inventory_item",
    "inventory_inspectioncertificate",
  ]);
  assert.deepEqual(result.hidden, [
    "auth_user",
    "django_session",
    "silk_request",
    "token_blacklist_outstandingtoken",
  ]);
});

test("hidden table warning does not leak sensitive table names in normal discovery", () => {
  const warning = formatHiddenSqlTablesWarning(["auth_user", "django_session"]);

  assert.match(warning, /2 internal or sensitive tables are hidden/i);
  assert.doesNotMatch(warning, /auth_user/);
  assert.doesNotMatch(warning, /django_session/);
});

test("sql select tool description reinforces schema-first usage", () => {
  const selectTool = TOOLS.find(tool => tool.name === "sql_db_select");
  assert.ok(selectTool);
  assert.match(selectTool.description, /Do not guess table names/i);
  assert.match(selectTool.description, /sql_db_list_tables/i);
  assert.match(selectTool.description, /sql_db_schema/i);
  assert.match(selectTool.description, /LIMIT/i);
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
