import assert from "node:assert/strict";
import test from "node:test";

import {
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
