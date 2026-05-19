import assert from "node:assert/strict";
import test from "node:test";

import {
  requestFormSubmit,
  formatFrontendActionResult,
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

test("allows approved submit tool to reach the browser when page context is stale", () => {
  const access = resolveFrontendActionAccess(
    {
      configurable: {
        pageContext: {
          actions: [{ name: "open_create_inspection_form", allowed: true }],
        },
      },
    },
    "request_form_submit",
    { allowMissingRegisteredAction: true }
  );

  assert.deepEqual(access, { ok: true });
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
});
