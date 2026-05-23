import assert from "node:assert/strict";
import test from "node:test";

import { getFormWorkflowGuidance } from "./form-workflows.js";

test("matches stock_entry_create with underscores", () => {
  const guidance = getFormWorkflowGuidance("stock_entry_create");
  assert.ok(guidance);
  assert.match(guidance, /entry_type FIRST/);
});

test("matches stock-entry-create with dashes", () => {
  const guidance = getFormWorkflowGuidance("stock-entry-create");
  assert.ok(guidance);
  assert.match(guidance, /entry_type FIRST/);
});

test("matches inspection_create", () => {
  const guidance = getFormWorkflowGuidance("inspection_create");
  assert.ok(guidance);
  assert.match(guidance, /department/);
});

test("matches inspection stage form with dynamic ID", () => {
  const guidance = getFormWorkflowGuidance("inspection-detail-47-central_register");
  assert.ok(guidance);
  assert.match(guidance, /Central Register/);
});

test("matches finance_review stage form", () => {
  const guidance = getFormWorkflowGuidance("inspection-detail-99-finance_review");
  assert.ok(guidance);
  assert.match(guidance, /Finance Review/);
});

test("matches stock_details stage form", () => {
  const guidance = getFormWorkflowGuidance("inspection-detail-12-stock_details");
  assert.ok(guidance);
  assert.match(guidance, /Stock Details/);
});

test("matches item_create", () => {
  const guidance = getFormWorkflowGuidance("item_create");
  assert.ok(guidance);
  assert.match(guidance, /category FIRST/);
});

test("matches category_create", () => {
  const guidance = getFormWorkflowGuidance("category_create");
  assert.ok(guidance);
  assert.match(guidance, /category_type/);
});

test("matches location_create", () => {
  const guidance = getFormWorkflowGuidance("location_create");
  assert.ok(guidance);
  assert.match(guidance, /location_type/);
});

test("matches stock_register_create", () => {
  const guidance = getFormWorkflowGuidance("stock_register_create");
  assert.ok(guidance);
  assert.match(guidance, /location/);
});

test("matches sublocation_create", () => {
  const guidance = getFormWorkflowGuidance("sublocation_create");
  assert.ok(guidance);
  assert.match(guidance, /parent location/);
});

test("matches subcategory_create", () => {
  const guidance = getFormWorkflowGuidance("subcategory_create");
  assert.ok(guidance);
  assert.match(guidance, /parent category/);
});

test("returns null for unknown form", () => {
  const guidance = getFormWorkflowGuidance("custom_module_xyz_create");
  assert.strictEqual(guidance, null);
});

test("matches final_approval stage form", () => {
  const guidance = getFormWorkflowGuidance("inspection-detail-5-final_approval");
  assert.ok(guidance);
  assert.match(guidance, /Final Approval/);
});
