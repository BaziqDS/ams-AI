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

test("prompt reuses the active form and current list page context", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /LIVE PAGE STATE contains an activeForm/i);
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Do not call open_form, open_create_\*_form, or navigate_to_route for the same task\/form/i
  );
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /current route already matches the user's target page\/module/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Treat duplicate navigation to the same route as a mistake/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /filters, pagination, filtered_total, and visible_rows/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Do not reapply the same filters/i);
});

test("prompt routes current list search filters pagination and row opens through frontend actions", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /LIST CONTROL ACTIONS/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /set_list_filters/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /clear_list_filters/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /go_to_list_page/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /open_visible_row/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /available_filters/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /refreshed LIVE PAGE STATE/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Do not use DOM\/browser guessing/i);
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

test("prompt treats manual form submits as completed workflow state", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /manual or user-initiated submit/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /lastSubmitResult.*ok=true/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /for any AMS module/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Do not call request_form_submit for that already-submitted form/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /redirectTo/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /module route rules/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /recordId/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Last closed form/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /before calling request_form_submit/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /inspection_create.*recordId/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /current route already equals redirectTo/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /use current \/inspections\/\{recordId\} detail context/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /otherwise call navigate_to_route with path "\/inspections\/\{recordId\}"/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /reason=user_submitted_manually/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /reason=user_closed_form/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /reason=user_navigated_away/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Do not retry request_form_submit/i);
});

test("prompt treats submittedValues as the final approved form state", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /result\.submittedValues/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /authoritative final form values/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /APPROVED VALUES OVERRIDE EARLIER FILLS/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /CONSUMABLE to FIXED_ASSET/i);
});

test("prompt avoids post-create duplicate navigation", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /POST-CREATE WORKFLOW/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /first compare LIVE PAGE STATE current route/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /If already on the detail route, do not call navigate_to_route/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Only call navigate_to_route when the current route is different/i);
});

test("prompt does not advertise Tavily or web search tools", () => {
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /Tavily/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /web search/i);
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
    /Never bypass the AMS UI workflow/i
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

test("prompt does not expose direct database-query tools or fallback instructions", () => {
  const removedTechnologyName = ["s", "q", "l"].join("");
  const removedToolPrefix = `${removedTechnologyName}_db_`;

  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, new RegExp(removedToolPrefix, "i"));
  assert.doesNotMatch(
    SYSTEM_PROMPT_TEMPLATE,
    new RegExp(`${removedTechnologyName} SCHEMA-FIRST RULE`, "i"),
  );
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /Database access is READ-ONLY/i);
  assert.doesNotMatch(
    SYSTEM_PROMPT_TEMPLATE,
    new RegExp(`${["S", "E", "L", "E", "C", "T"].join("")} query`, "i"),
  );
  assert.doesNotMatch(
    SYSTEM_PROMPT_TEMPLATE,
    new RegExp(`\\b${removedTechnologyName}\\b`, "i"),
  );
});

test("prompt resolves form data through page context and frontend option tools", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /do not pre-resolve dropdown or foreign-key IDs before opening the relevant form/i
  );
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /First open the form through the registered frontend action/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /department=CSIT/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /search_form_options/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /resolve IDs from the active form/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /never send display text as a select value/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /put row data under the "items" key/i);
});

test("prompt treats user-named option values as hard requirements", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /EXPLICIT OPTION INTENT/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /hard requirement/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /approximate text/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /search_form_options before patching/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /prefilled/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /auto-selected/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /tell the user/i);
});

test("prompt requires semantic category judgment when creating items", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /ITEM CATEGORY JUDGMENT/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /subcategory/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /category_path/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Stationary/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /create a new category or subcategory/i);
});

test("prompt requires Central Register item linking before item creation", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /CENTRAL REGISTER ITEM LINKING/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /description\/specifications/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /redundant catalog item/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /ask the user/i);
});

test("prompt requires complete required field groups on form rows", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /required=true/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /fill all required sibling fields/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /WORKFLOW guidance/i);
});

test("prompt stops repeated form retry loops before hitting graph recursion limits", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /LOOP GUARD/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /after two failed attempts/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /stop retrying tools/i);
});

test("prompt distinguishes current inspection stage from next transition", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /current_stage/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /next_stage/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /do not describe the current stage as a future stage/i);
});

test("prompt tells the agent to use detail page context as the primary current-record source", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /DETAIL PAGE CONTEXT/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /current record/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /first source/i);
});

test("prompt keeps page readable contracts generic instead of enumerating route schemas", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /route-scoped readables/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /visible_rows/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /On \/inspections, a readable contains/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /On \/items, a readable contains/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /On \/categories, a readable contains/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /On \/locations, a readable contains/i);
});

test("prompt forbids answering current-page references from stale route memory", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /matching detail or list context/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /do not answer from older route/i);
});

test("prompt relies on the generated OpenUI system prompt instead of custom correction rules", () => {
  const removedRepairMarker = [
    "OPENUI",
    "RENDERER",
    "REPAIR",
    "REQUEST",
  ].join("_");
  const removedRecipeHeading = ["AMS", "OpenUI", "composition", "recipes"].join(" ");
  const removedChartRule = ["There", "is", "no", "generic", "Chart", "component"].join(" ");
  const removedInlineRule = ["never", "assign", "variables", "inside", "arrays"].join(" ");

  assert.match(SYSTEM_PROMPT_TEMPLATE, /OpenUI system prompt generated by the OpenUI library/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, new RegExp(removedRepairMarker));
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, new RegExp(removedRecipeHeading, "i"));
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, new RegExp(removedChartRule, "i"));
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, new RegExp(removedInlineRule, "i"));
  assert.match(SYSTEM_PROMPT_TEMPLATE, /@ToAssistant/);
});

test("prompt uses the documented OpenUI prompt options without extra binding syntax", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /ENTIRE response must be valid openui-lang code/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /root` is the entry point/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /Arguments are POSITIONAL/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /Declare mutable state with `\$varName/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /String concatenation: `"text" \+ \$var/i);
});

test("prompt requires every visible final response to be OpenUI", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Every visible final assistant message must be OpenUI/i,
  );
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /must start with a `root =` OpenUI entry point/i,
  );
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Do not send plain text, markdown, fenced markdown, JSON, or explanatory prose/i,
  );
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /Even for short acknowledgements, greetings, blockers/i,
  );
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /still format the reply as OpenUI/i,
  );
  assert.doesNotMatch(
    SYSTEM_PROMPT_TEMPLATE,
    /Return OpenUI for visual responses/i,
  );
  assert.doesNotMatch(
    SYSTEM_PROMPT_TEMPLATE,
    /reply briefly without calling any tools\./i,
  );
});

test("prompt continues after navigation or form-open actions with refreshed page context", () => {
  assert.match(
    SYSTEM_PROMPT_TEMPLATE,
    /After a frontend action navigates, opens a form, or changes which form is active/i
  );
  assert.match(SYSTEM_PROMPT_TEMPLATE, /system resumes the next model step with refreshed LIVE PAGE STATE/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /refreshed state as the only current page\/form context/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /wait for fresh page context/i);
  assert.doesNotMatch(SYSTEM_PROMPT_TEMPLATE, /ask the user to say "continue"/i);
});

test("prompt includes a compact generated module manifest for routing and form opens", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /AMS COPILOT MODULE MANIFEST \(COMPACT\)/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /live page state is authoritative/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /inspection_create/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /\/inspections\/\{id\}/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /category_create/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /subcategory_create/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /\/categories\/\{id\}/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /item_create/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /\/items\/\{id\}/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /stock_entry_create/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /\/stock-entries\/\{id\}/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /stock_register_create/);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /\/stock-registers\/\{id\}/);
});

test("module manifest section does not hardcode page data or workflow details", () => {
  const manifestSection = SYSTEM_PROMPT_TEMPLATE.match(
    /AMS COPILOT MODULE MANIFEST \(COMPACT\):[\s\S]*?Production rule:/i,
  )?.[0] ?? "";

  assert.match(manifestSection, /inspection_create/);
  assert.doesNotMatch(manifestSection, /list rows expose/i);
  assert.doesNotMatch(manifestSection, /workflow shape/i);
  assert.doesNotMatch(manifestSection, /root\/main university inspections/i);
  assert.doesNotMatch(manifestSection, /departmental\/non-root inspections/i);
  assert.doesNotMatch(manifestSection, /items\.N\.stock_register/i);
  assert.doesNotMatch(manifestSection, /finance_check_date/i);
});

test("durable prompt references detail page context as primary source", () => {
  assert.match(SYSTEM_PROMPT_TEMPLATE, /DETAIL PAGE CONTEXT/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /current record/i);
  assert.match(SYSTEM_PROMPT_TEMPLATE, /first source/i);
});
