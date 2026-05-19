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
});

test("prompt stops after navigation or form-open actions until page context refreshes", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /After a frontend action navigates, opens a form, or changes which form is active/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /wait for fresh page context/i);
});
