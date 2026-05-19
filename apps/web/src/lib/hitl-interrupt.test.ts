import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHitlResume,
  getHitlActionReviewCopy,
  isHitlInterruptSchema,
} from "./hitl-interrupt";

const request = {
  actionRequests: [
    {
      name: "request_form_submit",
      args: { formId: "category-form", intent: "save" },
      description: "Approve submitting the active AMS form?",
    },
  ],
  reviewConfigs: [
    {
      actionName: "request_form_submit",
      allowedDecisions: ["approve", "reject"],
    },
  ],
};

test("detects LangChain HITL interrupt requests", () => {
  assert.equal(isHitlInterruptSchema(request), true);
  assert.equal(isHitlInterruptSchema({ action_request: {}, config: {} }), false);
});

test("builds approve and reject resume payloads for HITL requests", () => {
  assert.deepEqual(buildHitlResume(request, "approve"), {
    decisions: [{ type: "approve" }],
  });
  assert.deepEqual(buildHitlResume(request, "reject"), {
    decisions: [
      {
        type: "reject",
        message: "User rejected request_form_submit. Do not submit the form.",
      },
    ],
  });
});

test("builds production review copy for AMS form submit approval", () => {
  const copy = getHitlActionReviewCopy({
    name: "request_form_submit",
    args: { formId: "inspection_detail_42_stock_details", intent: "submit" },
    description: "Approve submitting the active AMS form?",
  });

  assert.equal(copy.title, "Submit active AMS form");
  assert.match(copy.description, /runs against the form currently open/i);
  assert.deepEqual(copy.details, [
    "Form: inspection_detail_42_stock_details",
    "Intent: submit",
  ]);
});
