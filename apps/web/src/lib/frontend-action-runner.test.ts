import assert from "node:assert/strict";
import test from "node:test";
import { runFrontendActionInterrupt } from "./frontend-action-runner";
import type { FrontendActionInterrupt } from "./frontend-action-interrupt";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("frontend action runner resumes the agent even after the view stops accepting UI updates", async () => {
  const actionResult = deferred<unknown>();
  let mounted = true;
  const submitCalls: unknown[] = [];

  const interrupt: FrontendActionInterrupt = {
    type: "frontend_action_request",
    action: {
      name: "set_form_values",
      args: { values: { code: "CN-2026-001" } },
    },
  };

  const run = runFrontendActionInterrupt(interrupt, {
    callAction: () => actionResult.promise,
    getFreshContext: async () => ({
      readables: [],
      actions: [],
    }),
    submit: (...args: unknown[]) => {
      submitCalls.push(args);
    },
    isMounted: () => mounted,
    onStatus: () => {
      assert.equal(mounted, true);
    },
  });

  mounted = false;
  actionResult.resolve({ ok: true, applied: ["code"] });
  await run;

  assert.equal(submitCalls.length, 1);
  assert.deepEqual(submitCalls[0], [
    {},
    {
      command: {
        resume: {
          ok: true,
          action: interrupt.action,
          result: { ok: true, applied: ["code"] },
        },
      },
      config: {
        recursion_limit: 80,
        configurable: {
          pageContext: {
            readables: [],
            actions: [],
          },
        },
      },
      streamMode: ["values", "custom"],
    },
  ]);
});

test("frontend action runner resumes with the fresh context provided after the frontend action resolves", async () => {
  const submitCalls: unknown[] = [];
  const pageContext = {
    readables: [
      { id: "__ams_runtime_context", value: { route: { pathname: "/inspections/13" } } },
    ],
    actions: [],
  };

  const interrupt: FrontendActionInterrupt = {
    type: "frontend_action_request",
    action: {
      name: "navigate_to_route",
      args: { path: "/inspections/13" },
    },
  };

  await runFrontendActionInterrupt(interrupt, {
    callAction: async () => ({
      ok: true,
      contextReady: true,
      contextSummary: { route: "/inspections/13" },
    }),
    getFreshContext: async () => pageContext,
    submit: (...args: unknown[]) => {
      submitCalls.push(args);
    },
  });

  assert.equal(submitCalls.length, 1);
  assert.deepEqual(
    (submitCalls[0] as Array<{ config?: { configurable?: { pageContext?: unknown } } }>)[1]
      .config?.configurable?.pageContext,
    pageContext,
  );
});

test("frontend action runner annotates submit results with current page state", async () => {
  const submitCalls: unknown[] = [];
  const pageContext = {
    readables: [
      {
        id: "__ams_runtime_context",
        value: { route: { pathname: "/inspections/43" } },
      },
      {
        id: "inspection-create-form",
        value: { route: "/inspections/43", activeForm: null },
      },
    ],
    actions: [],
  };

  const interrupt: FrontendActionInterrupt = {
    type: "frontend_action_request",
    action: {
      name: "request_form_submit",
      args: { formId: "inspection_create", intent: "submit" },
    },
  };

  await runFrontendActionInterrupt(interrupt, {
    callAction: async () => ({
      ok: true,
      message: "Inspection certificate submitted successfully.",
      recordId: 43,
      redirectTo: "/inspections/43",
    }),
    getFreshContext: async () => pageContext,
    submit: (...args: unknown[]) => {
      submitCalls.push(args);
    },
  });

  const resume = (submitCalls[0] as Array<{
    command?: { resume?: { result?: Record<string, unknown> } };
  }>)[1].command?.resume;

  assert.deepEqual(resume?.result, {
    ok: true,
    message: "Inspection certificate submitted successfully.",
    recordId: 43,
    redirectTo: "/inspections/43",
    currentRoute: "/inspections/43",
    activeFormId: null,
    formClosed: true,
    submittedFormId: "inspection_create",
    routeMatchesRedirect: true,
  });
});

test("frontend action runner passes context-not-ready action results back to the agent", async () => {
  const submitCalls: unknown[] = [];
  const pageContext = { readables: [], actions: [] };

  await runFrontendActionInterrupt(
    {
      type: "frontend_action_request",
      action: {
        name: "navigate_to_route",
        args: { path: "/inspections" },
      },
    },
    {
      callAction: async () => ({
        ok: false,
        errorType: "context_not_ready",
        message: 'Page context was not ready. Expected route "/inspections" with visible_rows.',
        contextReady: false,
      }),
      getFreshContext: async () => pageContext,
      submit: (...args: unknown[]) => {
        submitCalls.push(args);
      },
    },
  );

  assert.equal(submitCalls.length, 1);
  const resume = (submitCalls[0] as Array<{ command?: { resume?: { ok?: boolean; result?: { errorType?: string } } } }>)[1]
    .command?.resume;
  assert.equal(resume?.ok, true);
  assert.equal(resume?.result?.errorType, "context_not_ready");
});
