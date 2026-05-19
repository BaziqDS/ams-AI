import assert from "node:assert/strict";
import test from "node:test";

import { FORM_SUBMIT_APPROVAL } from "./approval-middleware.js";

test("requires human approval before request_form_submit can execute", () => {
  assert.deepEqual(
    FORM_SUBMIT_APPROVAL.interruptOn?.request_form_submit,
    {
      allowedDecisions: ["approve", "reject"],
      description:
        "Review and approve this AMS form action. It will run against the currently open form in the browser using your signed-in permissions and may create, update, submit, or advance workflow records.",
    },
  );
});
