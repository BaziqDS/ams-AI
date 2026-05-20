import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM_PROMPT_TEMPLATE } from "./prompts.js";

test("prompt requires route-aware navigation suggestions before form work", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /current live page context is authoritative/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Do not compare it with older URLs/i);
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Do not suggest navigating to the same route/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Open Inspections/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /@OpenUrl\("\/inspections"\)/);
});

test("prompt forbids claiming submit success without verified frontend result", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Never claim a create\/update\/submit succeeded/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /ok=true/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /fieldErrors/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /lastUserEdit/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /PARTIAL/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /unknown fields/i);
});

test("prompt tells the agent to use compact AMS activity memory", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /__ams_activity_context/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /compact app activity memory/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /last user field edit/i);
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Do not claim events that are not present/i
  );
});

test("prompt tells the agent to preflight permissions before write actions", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /__ams_permission_context/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /permission\/capability snapshot/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /frontendActions\.allowed/);
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Do not call a blocked frontend action/i
  );
});

test("prompt routes inspection stage transitions through frontend submit actions", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Operational workflow commands/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /send it to the next stage/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /request_form_submit/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /intent "submit"/i);
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Never use SQL to perform or simulate workflow transitions/i
  );
});

test("prompt forbids the old stage-transition handoff rule", () => {
  assert.doesNotMatch(
    SYSTEM_PROMPT_TEMPLATE,
    /For deletes or stage transitions, explain that the user needs to perform them in the UI/i
  );
});

test("prompt only names registered frontend form tools", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /set_form_values/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Writable field schema/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /read-only context/);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /set_fields/);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /set_inspection_items/);
});

test("prompt discourages SQL discovery during active form filling", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Do not call sql_db_.*just to discover form fields/i
  );
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /For inspection item rows, put row data under the "items" array/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /items\.0\.central_register/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /do not invent/i);
});

test("prompt requires complete required field groups on inspection stages", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /required=true/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /fill all required sibling fields/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /central_register_page_no/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /stock_register_page_no/i);
});

test("prompt distinguishes current inspection stage from next transition", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /current_stage/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /next_stage/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /do not describe the current stage as a future stage/i);
});

test("prompt requires schema-first SQL for broad database questions", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /SQL SCHEMA-FIRST RULE/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /call sql_db_list_tables/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /call sql_db_schema/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Do not guess table names/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /inventory_category/i);
});

test("prompt requires bounded SQL result sets and error recovery", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /LIMIT/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /aggregate/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /If sql_db_select fails/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /do not retry by guessing/i);
});

test("prompt tells the agent to use detail page context before SQL", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /DETAIL PAGE CONTEXT/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /current record/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /before SQL/i);
});

test("prompt forbids answering current-page references from stale route memory", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /matching detail or list context/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /do not answer from older route/i);
});

test("prompt includes AMS OpenUI recipes for richer generative UI", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /AMS OpenUI composition recipes/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /inspection_certificate_detail/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /item_distribution_summary/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /low_stock_report/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /maintenance_due_report/i);
});

test("prompt tells the agent when to use richer OpenUI components", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Use Tabs when/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Use Steps for workflow/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Use Tag for status/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Use Callout for blockers/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Use charts only when/i);
});

test("prompt forbids invalid inline OpenUI variable assignments", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /never assign variables inside arrays/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /include every defined variable/i);
});

test("prompt stops after navigation or form-open actions until page context refreshes", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /After a frontend action navigates, opens a form, or changes which form is active/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /wait for fresh page context/i);
});

test("prompt lets the agent triage hidden proactive update events", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /AMS_PROACTIVE_UPDATE_EVENT/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /decide whether a proactive response would actually help/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /__AMS_NO_PROACTIVE_RESPONSE__/);
});
