import assert from "node:assert/strict";
import test from "node:test";

import {
  requestFormSubmit,
  emitFrontendAction,
  runFrontendAction,
  searchFormOptions,
  searchFormOptionsArgsSchema,
  setFormValues,
  setFormValuesArgsSchema,
  formatFrontendActionResult,
  hasPendingInterruptResume,
  resolveFrontendActionAccess,
} from "./frontend-tools.js";

test("denies frontend actions marked unavailable by current page context", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [
            {
              name: "request_form_submit",
              allowed: false,
              description: "Request save/submit for the active AMS form.",
            },
          ],
        },
      },
    },
    "request_form_submit"
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /not allowed/i);
  assert.match(access.message, /permission/i);
});

test("denied frontend actions include page-provided permission details", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [
            {
              name: "open_create_category_form",
              allowed: false,
              blockedReason:
                "Requires capability categories:manage, current level is view.",
              requiredCapabilities: [{ module: "categories", level: "manage" }],
            },
          ],
        },
      },
    },
    "open_create_category_form"
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /categories:manage/);
  assert.match(access.message, /current level is view/);
  assert.match(access.message, /requiredCapabilities/);
});

test("allows registered frontend actions when current page context allows them", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [{ name: "set_form_values", allowed: true }],
        },
      },
    },
    "set_form_values"
  );

  assert.deepEqual(access, { ok: true });
});

test("blocks form actions that target a stale form on another page", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          readables: [
            {
              id: "__ams_runtime_context",
              description: "Runtime",
              value: {
                route: {
                  pathname: "/stock-entries",
                  observed_at: "2026-05-22T10:05:44.236Z",
                },
              },
            },
            {
              id: "stock-entry-create-form",
              description: "AMS form not active: Create Stock Entry.",
              value: {
                route: "/stock-entries",
                activeForm: null,
              },
            },
          ],
          actions: [
            { name: "get_app_map", allowed: true },
            { name: "open_create_stock_entry_form", allowed: true },
          ],
        },
      },
    },
    "search_form_options",
    { targetFormId: "inspection_detail_35_stock_details" }
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /inspection_detail_35_stock_details/);
  assert.match(access.message, /\/stock-entries/);
  assert.match(access.message, /no active AMS form/i);
  assert.match(access.message, /Do not retry stale form actions/i);
});

test("does not allow generic frontend action dispatch to bypass submit approval", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [{ name: "request_form_submit", allowed: true }],
        },
      },
    },
    "request_form_submit",
    { allowProtectedActions: false }
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /dedicated request_form_submit tool/i);
});

test("does not allow generic frontend action dispatch to bypass dedicated form tools", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [{ name: "set_form_values", allowed: true }],
        },
      },
    },
    "set_form_values",
    { allowProtectedActions: false }
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /dedicated set_form_values tool/i);
  assert.match(access.message, /run_frontend_action/i);
});

test("does not allow generic frontend action dispatch to bypass form option search", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [{ name: "search_form_options", allowed: true }],
        },
      },
    },
    "search_form_options",
    { allowProtectedActions: false }
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /dedicated search_form_options tool/i);
  assert.match(access.message, /run_frontend_action/i);
});

test("does not expose low-value form helper actions through generic dispatch", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [{ name: "validate_active_form", allowed: true }],
        },
      },
    },
    "validate_active_form",
    { allowProtectedActions: false }
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /internal form helper/i);
  assert.match(access.message, /set_form_values/);
});

test("blocks submit tool before approval when no active form is registered", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          readables: [
            {
              id: "__ams_runtime_context",
              description: "Runtime",
              value: {
                route: {
                  pathname: "/inspections",
                  observed_at: "2026-05-22T10:05:44.236Z",
                },
              },
            },
            {
              id: "inspection-create-form",
              description: "AMS form not active: New Inspection Certificate.",
              value: {
                route: "/inspections",
                activeForm: null,
              },
            },
          ],
          actions: [{ name: "open_create_inspection_form", allowed: true }],
        },
      },
    },
    "request_form_submit"
  );

  assert.equal(access.ok, false);
  assert.match(access.message, /not registered/i);
  assert.match(access.message, /open the relevant form/i);
});

test("detects a pending frontend action resume even after the submitted form closed", () => {
  const config = {
    configurable: {
      __pregel_scratchpad: {
        interruptCounter: -1,
        resume: [],
        nullResume: {
          ok: true,
          action: {
            name: "request_form_submit",
            args: { formId: "inspection_create", intent: "submit" },
          },
          result: {
            ok: true,
            message: "Inspection certificate submitted successfully.",
            recordId: 43,
            redirectTo: "/inspections/43",
          },
        },
      },
      pageContext: {
        readables: [
          {
            id: "__ams_runtime_context",
            description: "Runtime",
            value: {
              route: {
                pathname: "/inspections",
                observed_at: "2026-05-22T13:07:16.140Z",
              },
            },
          },
          {
            id: "inspection-create-form",
            description: "AMS form not active: New Inspection Certificate.",
            value: {
              route: "/inspections",
              activeForm: null,
            },
          },
        ],
        actions: [{ name: "open_create_inspection_form", allowed: true }],
      },
    },
  };

  assert.equal(hasPendingInterruptResume(config), true);
  const result = emitFrontendAction(
    config,
    "request_form_submit",
    { formId: "inspection_create", intent: "submit" },
    { requireRegistered: true },
    () => ({
      ok: true,
      result: {
        ok: true,
        message: "Inspection certificate submitted successfully.",
        recordId: 43,
        redirectTo: "/inspections/43",
      },
    }),
  );

  assert.equal(result.ok, true);
  assert.match(result.message, /SUCCEEDED/);
  assert.match(result.message, /recordId\":43/);
});

test("does not treat HITL approval decisions as frontend action resumes", () => {
  const config = {
    configurable: {
      __pregel_scratchpad: {
        interruptCounter: -1,
        resume: [],
        nullResume: {
          decisions: [{ type: "approve" }],
        },
      },
      pageContext: {
        readables: [
          {
            id: "__ams_runtime_context",
            value: { route: { pathname: "/inspections" } },
          },
          {
            id: "inspection-create-form",
            value: { route: "/inspections", activeForm: null },
          },
        ],
        actions: [{ name: "open_create_inspection_form", allowed: true }],
      },
    },
  };

  assert.equal(hasPendingInterruptResume(config), false);
  const result = emitFrontendAction(
    config,
    "request_form_submit",
    { formId: "inspection_create", intent: "submit" },
    { requireRegistered: true },
    () => {
      throw new Error("frontend interrupt should not be emitted");
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /STALE_FORM_CONTEXT/);
});

test("formats frontend action failures so the model cannot treat them as success", () => {
  const message = formatFrontendActionResult("request_form_submit", {
    ok: false,
    action: {
      name: "request_form_submit",
      args: { formId: "inspection_create", intent: "submit" },
    },
    result: {
      ok: false,
      errorType: "validation_error",
      message: "Inspection code already exists.",
      fieldErrors: { inspection_code: "Duplicate inspection code." },
    },
  });

  assert.match(message, /FAILED/i);
  assert.match(message, /Inspection code already exists/);
  assert.match(message, /inspection_code/);
});

test("formats empty option failures with create guidance", () => {
  const message = formatFrontendActionResult("search_form_options", {
    ok: false,
    result: {
      ok: false,
      status: "not_found",
      optionsState: "empty",
      totalCount: 0,
      message: "No options exist for Item 1 Stock Register in the current form state.",
    },
  });

  assert.match(message, /EMPTY_OPTIONS/);
  assert.match(message, /do not guess an ID/i);
  assert.match(message, /offer to help create/i);
});

test("formats requested option not found separately from empty option lists", () => {
  const message = formatFrontendActionResult("search_form_options", {
    ok: false,
    result: {
      ok: false,
      status: "not_found",
      field: "department",
      query: "BCIT",
      candidates: [],
      totalCount: 3,
      hasMore: false,
      optionsState: "complete",
    },
  });

  assert.match(message, /OPTION_NOT_FOUND/);
  assert.match(message, /department/);
  assert.match(message, /BCIT/);
  assert.match(message, /not available/i);
  assert.match(message, /Present the available alternatives/i);
  assert.doesNotMatch(message, /EMPTY_OPTIONS/);
  assert.doesNotMatch(message, /no available options/i);
  assert.doesNotMatch(message, /Raw result/i);
});

test("formats instance option name searches as dependency guidance", () => {
  const message = formatFrontendActionResult("search_form_options", {
    ok: false,
    result: {
      ok: false,
      status: "not_found",
      field: "items.0.instances",
      query: "Core i5",
      candidates: [],
      totalCount: 16,
      hasMore: false,
      optionsState: "complete",
    },
  });

  assert.match(message, /INSTANCE_OPTION_QUERY_MISMATCH/);
  assert.match(message, /instances are serial\/QR options/i);
  assert.match(message, /resolve and set items\.0\.item/i);
  assert.match(message, /empty query/i);
  assert.doesNotMatch(message, /create\/enable/i);
});

test("formats batch option item-name searches as dependency guidance", () => {
  const message = formatFrontendActionResult("search_form_options", {
    ok: false,
    result: {
      ok: false,
      status: "not_found",
      field: "items.0.batch",
      query: "Core i5",
      candidates: [],
      totalCount: 3,
      hasMore: false,
      optionsState: "complete",
    },
  });

  assert.match(message, /BATCH_OPTION_QUERY_MISMATCH/);
  assert.match(message, /batches are batch-number options/i);
  assert.match(message, /resolve and set items\.0\.item/i);
  assert.match(message, /empty query/i);
  assert.doesNotMatch(message, /create\/enable/i);
});

test("formats register option item-name searches as dependency guidance", () => {
  const message = formatFrontendActionResult("search_form_options", {
    ok: false,
    result: {
      ok: false,
      status: "not_found",
      field: "items.0.stock_register",
      query: "Core i5",
      candidates: [],
      totalCount: 2,
      hasMore: false,
      optionsState: "complete",
    },
  });

  assert.match(message, /REGISTER_OPTION_QUERY_MISMATCH/);
  assert.match(message, /register fields use register numbers/i);
  assert.match(message, /resolve and set items\.0\.item/i);
  assert.match(message, /empty query/i);
  assert.doesNotMatch(message, /create\/enable/i);
});

test("formats ambiguous and dependency-blocked option searches as blockers", () => {
  const ambiguous = formatFrontendActionResult("search_form_options", {
    ok: false,
    result: {
      ok: false,
      status: "ambiguous",
      field: "department",
      query: "CI",
      candidates: [
        { label: "CSIT", value: 1 },
        { label: "Civil", value: 2 },
      ],
      totalCount: 10,
      hasMore: false,
      optionsState: "complete",
    },
  });
  const missingDependencies = formatFrontendActionResult("search_form_options", {
    ok: false,
    result: {
      ok: false,
      status: "missing_dependencies",
      field: "items.0.instances",
      query: "SN-001",
      candidates: [],
      totalCount: 0,
      hasMore: false,
      optionsState: "requires_dependency",
      missingDependencies: ["items.0.item"],
    },
  });

  assert.match(ambiguous, /AMBIGUOUS_FORM_OPTIONS/);
  assert.match(ambiguous, /pick the right one/i);
  assert.doesNotMatch(ambiguous, /Raw result/i);
  assert.match(missingDependencies, /OPTION_DEPENDENCIES_MISSING/);
  assert.match(missingDependencies, /items\.0\.item/);
  assert.doesNotMatch(missingDependencies, /Raw result/i);
});

test("formats invalid form value schema failures with row-field guidance", () => {
  const message = formatFrontendActionResult("set_form_values", {
    ok: false,
    result: {
      ok: false,
      errorType: "invalid_form_values_schema",
      message: "The submitted values do not match the active form schema.",
      fieldErrors: { items: "Invalid input" },
    },
  });

  assert.match(message, /items\.0\.stock_register/);
  assert.match(message, /nested objects/i);
});

test("formats root invalid form value schema failures without row-field guesswork", () => {
  const message = formatFrontendActionResult("set_form_values", {
    ok: false,
    result: {
      ok: false,
      errorType: "invalid_form_values_schema",
      message: "The submitted values do not match the active form schema.",
      fieldErrors: { values: "Invalid input" },
    },
  });

  assert.match(message, /exact writable field names/i);
  assert.doesNotMatch(message, /items\.0\.stock_register/);
  assert.doesNotMatch(message, /Raw result/i);
});

test("formats invalid select values as non-retryable missing options", () => {
  const message = formatFrontendActionResult("set_form_values", {
    ok: false,
    result: {
      ok: false,
      errorType: "invalid_select_value",
      message:
        "One or more select fields used values that are not available in the active form options.",
      fieldErrors: { location: "Invalid option \"Unknown Lab\"." },
    },
  });

  assert.match(message, /NON_RETRYABLE_INVALID_SELECT_VALUE/);
  assert.match(message, /must be created or enabled/i);
  assert.doesNotMatch(message, /Raw result/i);
});

test("formats partial form patches so ignored fields are not treated as success", () => {
  const message = formatFrontendActionResult("set_form_values", {
    ok: true,
    result: {
      ok: true,
      applied: ["contract_no"],
      unknown: ["accepted_quantity", "item_description"],
    },
  });

  assert.match(message, /PARTIAL/i);
  assert.match(message, /accepted_quantity/);
  assert.match(message, /not filled/i);
  assert.doesNotMatch(message, /^Frontend action "set_form_values" SUCCEEDED/);
});

test("submit tool description covers inspection workflow transitions", () => {
  assert.match(requestFormSubmit.description, /move.*next stage/i);
  assert.match(requestFormSubmit.description, /inspection/i);
  assert.match(requestFormSubmit.description, /intent.*submit/i);
  assert.match(requestFormSubmit.description, /human approval/i);
  assert.match(requestFormSubmit.description, /Do not use/i);
  assert.match(requestFormSubmit.description, /unresolved/i);
  assert.match(requestFormSubmit.description, /default/i);
});

test("set_form_values schema rejects raw array values", () => {
  const result = setFormValuesArgsSchema.safeParse({
    values: [
      {
        central_register: 1,
        central_register_page_no: "CR-2026-05-21-001",
        item: 3,
      },
    ],
    reason: "Filling central register rows.",
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error.issues), /Expected object/);
});

test("set_form_values tool contract explains repeatable row shape", () => {
  assert.match(setFormValues.description, /single JSON object/i);
  assert.match(setFormValues.description, /Never pass an array directly/i);
  assert.match(setFormValues.description, /Use this when/i);
  assert.match(setFormValues.description, /Do not use this/i);
  assert.match(setFormValues.description, /search_form_options/i);
  assert.match(setFormValues.description, /default/i);
  assert.match(setFormValues.description, /auto-selected/i);
  assert.match(setFormValuesArgsSchema.description ?? "", /values.*object/i);
  assert.match(
    setFormValuesArgsSchema.shape.values.description ?? "",
    /"items":\[/
  );

  const valid = setFormValuesArgsSchema.safeParse({
    formId: "inspection_detail_13_central_register",
    values: {
      items: [
        {
          central_register: 1,
          central_register_page_no: "CR-2026-05-21-001",
          item: 3,
        },
      ],
    },
    reason: "Filling central register rows.",
  });

  assert.equal(valid.success, true);
});

test("search_form_options schema supports row option lookups with current form values", () => {
  const valid = searchFormOptionsArgsSchema.safeParse({
    formId: "stock-entry-create",
    field: "items.0.instances",
    query: "SN-001",
    currentValues: {
      from_location: "5",
      items: [{ item: "3" }],
    },
    limit: 5,
  });

  assert.equal(valid.success, true);
  assert.match(searchFormOptions.description, /truncated/i);
  assert.match(searchFormOptions.description, /requires_dependency/i);
  assert.match(searchFormOptions.description, /Do not guess/i);
  assert.match(searchFormOptions.description, /Use this before set_form_values/i);
  assert.match(searchFormOptions.description, /user explicitly named/i);
  assert.match(searchFormOptions.description, /not_found/i);
  assert.match(searchFormOptions.description, /hard blocker/i);
  assert.match(searchFormOptions.description, /Do not use this/i);
});

test("generic frontend action tool explains scope and submit bypass limits", () => {
  assert.match(runFrontendAction.description, /Use this when/i);
  assert.match(runFrontendAction.description, /Do not use this/i);
  assert.match(runFrontendAction.description, /registered/i);
  assert.match(runFrontendAction.description, /request_form_submit/i);
  assert.match(runFrontendAction.description, /set_form_values/i);
  assert.match(runFrontendAction.description, /search_form_options/i);
});

test("frontend tool list exposes only production agent actions", async () => {
  const { FRONTEND_TOOLS } = await import("./frontend-tools.js");
  const names = FRONTEND_TOOLS.map((frontendTool) => frontendTool.name);

  assert.deepEqual(names, [
    "set_form_values",
    "search_form_options",
    "request_form_submit",
    "get_app_map",
    "run_frontend_action",
    "resolve_relative_date",
  ]);
  assert.doesNotMatch(names.join(","), /focus_form_field/);
  assert.doesNotMatch(names.join(","), /validate_active_form/);
});
