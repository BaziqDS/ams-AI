/**
 * Run with: node --test --experimental-strip-types --no-warnings src/react-agent/sql-guard.test.ts
 * (or from a workspace test runner that handles TS). These are pure unit tests
 * — no DB connection required. They lock down the read-only contract.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { validateReadOnlySql } from "./sql-guard.js";

describe("validateReadOnlySql — allows", () => {
  it("simple SELECT", () => {
    assert.equal(validateReadOnlySql("SELECT * FROM inventory_item").ok, true);
  });
  it("SELECT with WHERE/JOIN/ORDER BY/LIMIT", () => {
    assert.equal(
      validateReadOnlySql(
        "SELECT i.id, i.name FROM inventory_item i JOIN inventory_category c ON i.category_id = c.id WHERE c.id = 5 ORDER BY i.name LIMIT 10"
      ).ok,
      true
    );
  });
  it("SELECT with WITH (CTE)", () => {
    assert.equal(
      validateReadOnlySql(
        "WITH recent AS (SELECT id FROM inventory_inspectioncertificate WHERE stage = 'DRAFT') SELECT * FROM recent"
      ).ok,
      true
    );
  });
  it("SELECT with subquery and aggregations", () => {
    assert.equal(
      validateReadOnlySql(
        "SELECT category_id, COUNT(*) FROM inventory_item WHERE id IN (SELECT item_id FROM inventory_inspectionitem) GROUP BY category_id"
      ).ok,
      true
    );
  });
});

describe("validateReadOnlySql — rejects writes", () => {
  const cases: Array<[string, string]> = [
    ["INSERT INTO inventory_item (name) VALUES ('x')", "INSERT"],
    ["UPDATE inventory_item SET name = 'x' WHERE id = 1", "UPDATE"],
    ["DELETE FROM inventory_item WHERE id = 1", "DELETE"],
    ["DROP TABLE inventory_item", "DROP"],
    ["CREATE TABLE foo (id INTEGER)", "CREATE"],
    ["ALTER TABLE inventory_item ADD COLUMN x TEXT", "ALTER"],
    ["TRUNCATE inventory_item", "TRUNCATE"],
    ["REPLACE INTO inventory_item (id, name) VALUES (1, 'x')", "REPLACE"],
  ];
  for (const [sql, label] of cases) {
    it(`rejects ${label}`, () => {
      const result = validateReadOnlySql(sql);
      assert.equal(result.ok, false, `expected rejection for: ${sql}`);
    });
  }
});

describe("validateReadOnlySql — rejects smuggling", () => {
  it("rejects multi-statement", () => {
    assert.equal(
      validateReadOnlySql("SELECT 1; DELETE FROM inventory_item").ok,
      false
    );
  });
  it("rejects multi-statement (trailing write)", () => {
    assert.equal(
      validateReadOnlySql("SELECT 1; INSERT INTO foo VALUES (1)").ok,
      false
    );
  });
  it("rejects PRAGMA", () => {
    assert.equal(validateReadOnlySql("PRAGMA writable_schema = 1").ok, false);
  });
  it("rejects ATTACH DATABASE", () => {
    assert.equal(
      validateReadOnlySql("ATTACH DATABASE '/tmp/x.db' AS evil").ok,
      false
    );
  });
  it("rejects DETACH DATABASE", () => {
    assert.equal(validateReadOnlySql("DETACH DATABASE evil").ok, false);
  });
  it("rejects VACUUM", () => {
    assert.equal(validateReadOnlySql("VACUUM").ok, false);
  });
  it("rejects load_extension call", () => {
    assert.equal(
      validateReadOnlySql("SELECT load_extension('/tmp/evil.so')").ok,
      false
    );
  });
  it("rejects empty query", () => {
    assert.equal(validateReadOnlySql("").ok, false);
    assert.equal(validateReadOnlySql("   ").ok, false);
  });
  it("points write attempts to registered frontend tools", () => {
    const result = validateReadOnlySql(
      "UPDATE inventory_item SET name = 'x' WHERE id = 1"
    );

    assert.equal(result.ok, false);
    assert.match(result.reason, /set_form_values/);
    assert.match(result.reason, /request_form_submit/);
    assert.doesNotMatch(result.reason, /set_fields/);
    assert.doesNotMatch(result.reason, /set_inspection_items/);
  });
});

describe("validateReadOnlySql - rejects sensitive internal data", () => {
  const cases: Array<[string, string]> = [
    ["SELECT password FROM auth_user", "auth_user"],
    ["SELECT session_data FROM django_session", "django_session"],
    ["SELECT token FROM token_blacklist_outstandingtoken", "token_blacklist"],
    ["SELECT raw_body FROM silk_request", "silk"],
  ];

  for (const [sql, label] of cases) {
    it(`rejects ${label}`, () => {
      const result = validateReadOnlySql(sql);

      assert.equal(result.ok, false, `expected rejection for: ${sql}`);
      assert.match(result.reason, /internal or sensitive/i);
    });
  }
});
