import assert from "node:assert/strict";
import test from "node:test";

import {
  getFrontendFailureStopMessage,
  getStaleFormToolCallStopMessage,
} from "./frontend-failure-guard.js";

test("empty form option results do not hard-stop — agent can offer to create", () => {
  const message = getFrontendFailureStopMessage([
    {
      name: "search_form_options",
      content:
        'Frontend action "search_form_options" FAILED. EMPTY_OPTIONS: the active form has no available options for stock_register. Do not guess an ID. field=stock_register',
    },
  ]);

  assert.equal(message, null);
});

test("option not found does not hard-stop — agent can present alternatives", () => {
  const message = getFrontendFailureStopMessage([
    {
      name: "search_form_options",
      content:
        'Frontend action "search_form_options" FAILED. OPTION_NOT_FOUND: requested option "BCIT" is not available for department. Available alternatives: CSIT, ECE, ME. field=department query=BCIT status=not_found totalCount=3.',
    },
  ]);

  assert.equal(message, null);
});

test("ambiguous and dependency-blocked option searches do not hard-stop", () => {
  const ambiguous = getFrontendFailureStopMessage([
    {
      name: "search_form_options",
      content:
        'Frontend action "search_form_options" FAILED. AMBIGUOUS_FORM_OPTIONS: query "CI" matched multiple options for department. Candidates: CSIT, CIT. field=department query=CI status=ambiguous.',
    },
  ]);
  const missingDependencies = getFrontendFailureStopMessage([
    {
      name: "search_form_options",
      content:
        'Frontend action "search_form_options" FAILED. OPTION_DEPENDENCIES_MISSING: cannot search items.0.instances yet. Fill these first: ["items.0.item"]. field=items.0.instances query=SN-001 status=missing_dependencies.',
    },
  ]);

  assert.equal(ambiguous, null);
  assert.equal(missingDependencies, null);
});

test("repeated invalid form schema failures stop nested row object retries", () => {
  const content =
    'Frontend action "set_form_values" FAILED. The submitted values do not match the active form schema. errorType=invalid_form_values_schema fieldErrors={"items":"Invalid input"}. Fields: items.';

  const message = getFrontendFailureStopMessage([
    { name: "set_form_values", content },
    { name: "set_form_values", content },
  ]);

  assert.match(message ?? "", /stop retrying/i);
  assert.match(message ?? "", /items\.0\.stock_register/i);
  assert.match(message ?? "", /not nested objects/i);
});

test("invalid select value does not hard-stop — agent can search for correct option", () => {
  const message = getFrontendFailureStopMessage([
    {
      name: "set_form_values",
      content:
        'Frontend action "set_form_values" FAILED. One or more select fields used values that are not available in the active form options. errorType=invalid_select_value fieldErrors={"location":"Invalid option \\"Unknown Lab\\". Allowed: Main Store=1"}. Raw result: {"ok":false,"errorType":"invalid_select_value"}. Fields: location.',
    },
  ]);

  assert.equal(message, null);
});

test("root invalid form schema failures stop with clean attempted-field guidance", () => {
  const content =
    'Frontend action "set_form_values" FAILED. Use exact writable field names from activeForm.setValuesSchema. The submitted values do not match the active form schema. errorType=invalid_form_values_schema fieldErrors={"values":"Invalid input"} Raw result: {"ok":false,"errorType":"invalid_form_values_schema"}. Fields: contract_date, date, location, items.';

  const message = getFrontendFailureStopMessage([
    { name: "set_form_values", content },
    { name: "set_form_values", content },
  ]);

  assert.match(message ?? "", /submitted patch did not match/i);
  assert.match(message ?? "", /contract_date, date, location, items/i);
  assert.match(message ?? "", /writable schema/i);
  assert.doesNotMatch(message ?? "", /Raw result/i);
  assert.doesNotMatch(message ?? "", /fieldErrors/i);
  assert.doesNotMatch(message ?? "", /items\.0\.stock_register/i);
});

test("stale form context failures stop old-page form retries", () => {
  const message = getFrontendFailureStopMessage([
    {
      name: "search_form_options",
      content:
        'Frontend action "search_form_options" FAILED. STALE_FORM_CONTEXT: targets stale form "inspection_detail_35_stock_details", but the current page (/stock-entries) has no active AMS form. Do not retry stale form actions.',
    },
  ]);

  assert.match(message ?? "", /current page is \/stock-entries/i);
  assert.match(message ?? "", /inspection_detail_35_stock_details/);
  assert.match(message ?? "", /open the relevant form/i);
  assert.match(message ?? "", /will stop/i);
});

test("stale submit tool calls stop before human approval is requested", () => {
  const message = getStaleFormToolCallStopMessage(
    [
      {
        tool_calls: [
          {
            name: "request_form_submit",
            args: {
              formId: "inspection_detail_35_central_register",
              intent: "submit",
            },
          },
        ],
      },
    ],
    {
      readables: [
        {
          id: "__ams_runtime_context",
          value: { route: { pathname: "/stock-entries" } },
        },
        {
          id: "stock-entry-create-form",
          value: { route: "/stock-entries", activeForm: null },
        },
      ],
    },
  );

  assert.match(message ?? "", /^root = TextContent/);
  assert.match(message ?? "", /current page is \/stock-entries/i);
  assert.match(message ?? "", /Open the relevant form again/i);
});

test("targetless submit tool calls stop when the user closed the form", () => {
  const message = getStaleFormToolCallStopMessage(
    [
      {
        tool_calls: [
          {
            name: "request_form_submit",
            args: { intent: "submit" },
          },
        ],
      },
    ],
    {
      readables: [
        {
          id: "__ams_runtime_context",
          value: { route: { pathname: "/inspections" } },
        },
        {
          id: "inspection-create-form",
          value: { route: "/inspections", activeForm: null },
        },
        {
          id: "__ams_activity_context",
          value: {
            lastClosedForm: {
              formId: "inspection_create",
              title: "New Inspection Certificate",
              route: "/inspections",
              closedAt: "2026-05-22T10:00:00.000Z",
            },
          },
        },
      ],
    },
  );

  assert.match(message ?? "", /^root = TextContent/);
  assert.match(message ?? "", /nothing active to submit/i);
  assert.match(message ?? "", /New Inspection Certificate/);
  assert.match(message ?? "", /Reopen the form/i);
});

test("repeated submit tool calls stop when the same form was already submitted", () => {
  const message = getStaleFormToolCallStopMessage(
    [
      {
        tool_calls: [
          {
            name: "request_form_submit",
            args: { intent: "submit" },
          },
        ],
      },
    ],
    {
      readables: [
        {
          id: "__ams_runtime_context",
          value: { route: { pathname: "/inspections" } },
        },
        {
          id: "inspection-create-form",
          value: {
            route: "/inspections",
            activeForm: { formId: "inspection_create" },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            lastSubmitResult: {
              formId: "inspection_create",
              formTitle: "New Inspection Certificate",
              ok: true,
              message: "Inspection certificate submitted successfully.",
              result: { ok: true, recordId: 35 },
              at: "2026-05-22T10:00:00.000Z",
            },
          },
        },
      ],
    },
  );

  assert.match(message ?? "", /already been submitted/i);
  assert.match(message ?? "", /New Inspection Certificate/);
  assert.match(message ?? "", /record 35/i);
  assert.match(message ?? "", /did not send another approval request/i);
});

test("successful submit is not re-blocked after the model already answered", () => {
  const message = getStaleFormToolCallStopMessage(
    [
      {
        tool_calls: [
          {
            name: "request_form_submit",
            args: {
              formId: "inspection_detail_44_finance_review",
              intent: "submit",
            },
          },
        ],
      },
      {
        name: "request_form_submit",
        content:
          'Frontend action "request_form_submit" SUCCEEDED. Result: {"ok":true,"message":"Inspection stage submitted successfully.","recordId":44,"redirectTo":"/inspections/44","currentRoute":"/inspections/44","activeFormId":null,"formClosed":true,"submittedFormId":"inspection_detail_44_finance_review","routeMatchesRedirect":true}.',
      },
      {
        content:
          "Inspection Certificate — CTR-2026-GEN-007\nFinance Review submitted. The detail page is open.",
      },
    ],
    {
      readables: [
        {
          id: "__ams_runtime_context",
          value: { route: { pathname: "/inspections/44" } },
        },
        {
          id: "inspection-detail-form",
          value: { route: "/inspections/44", activeForm: null },
        },
        {
          id: "__ams_activity_context",
          value: {
            lastSubmitResult: {
              formId: "inspection_detail_44_finance_review",
              formTitle: "Inspection Detail - Finance Review",
              ok: true,
              message: "Inspection stage submitted successfully.",
              result: {
                ok: true,
                recordId: 44,
                redirectTo: "/inspections/44",
              },
            },
          },
        },
      ],
    },
  );

  assert.equal(message, null);
});

test("consecutive create submits on a reusable create form are not blocked when a fresh form was opened after the previous submit", () => {
  const message = getStaleFormToolCallStopMessage(
    [
      {
        tool_calls: [
          {
            name: "request_form_submit",
            args: { intent: "submit" },
          },
        ],
      },
    ],
    {
      readables: [
        {
          id: "__ams_runtime_context",
          value: { route: { pathname: "/items" } },
        },
        {
          id: "item-create-form",
          value: {
            route: "/items",
            activeForm: {
              formId: "item-create",
              fields: [{ name: "name", type: "string" }],
            },
          },
        },
        {
          id: "__ams_activity_context",
          value: {
            lastSubmitResult: {
              formId: "item_create",
              formTitle: "Create Item",
              ok: true,
              result: { ok: true, recordId: 9 },
              at: "2026-05-22T10:00:00.000Z",
            },
            recentActivity: [
              {
                at: "2026-05-22T10:00:05.000Z",
                actor: "assistant",
                kind: "form_opened",
                formId: "item_create",
                title: "Opened Create Item",
              },
              {
                at: "2026-05-22T10:00:10.000Z",
                actor: "assistant",
                kind: "form_values_set",
                formId: "item_create",
                title: "Patched form values",
              },
            ],
          },
        },
      ],
    },
  );

  assert.equal(message, null);
});

test("single recoverable form failure does not stop the agent", () => {
  const message = getFrontendFailureStopMessage([
    {
      name: "set_form_values",
      content:
        'Frontend action "set_form_values" FAILED. The submitted values do not match the active form schema. errorType=invalid_form_values_schema fieldErrors={"values":"Invalid input"}. Fields: date.',
    },
  ]);

  assert.equal(message, null);
});
