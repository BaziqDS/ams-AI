import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFrontendActionResume,
  isFrontendActionInterruptSchema,
} from "./frontend-action-interrupt";

test("detects frontend action interrupt requests", () => {
  assert.equal(
    isFrontendActionInterruptSchema({
      type: "frontend_action_request",
      action: {
        name: "set_form_values",
        args: { values: { name: "Laptop" } },
      },
    }),
    true,
  );
  assert.equal(isFrontendActionInterruptSchema({ actionRequests: [] }), false);
});

test("builds structured frontend action resume payloads", () => {
  const request = {
    type: "frontend_action_request" as const,
    action: {
      name: "request_form_submit",
      args: { formId: "inspection_create", intent: "submit" },
    },
  };

  assert.deepEqual(buildFrontendActionResume(request, { ok: true, recordId: 12 }), {
    ok: true,
    action: request.action,
    result: { ok: true, recordId: 12 },
  });

  assert.deepEqual(buildFrontendActionResume(request, undefined, "Duplicate inspection code."), {
    ok: false,
    action: request.action,
    error: "Duplicate inspection code.",
  });
});
