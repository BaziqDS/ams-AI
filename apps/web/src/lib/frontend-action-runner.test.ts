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

test("frontend action runner waits for changed page context before resuming", async () => {
  const submitCalls: unknown[] = [];
  const contexts = [
    { readables: [{ id: "__ams_runtime_context", value: { route: "/categories" } }], actions: [] },
    { readables: [{ id: "__ams_runtime_context", value: { route: "/categories" } }], actions: [] },
    { readables: [{ id: "__ams_runtime_context", value: { route: "/inspections/13" } }], actions: [] },
  ];

  const interrupt: FrontendActionInterrupt = {
    type: "frontend_action_request",
    action: {
      name: "navigate_to_route",
      args: { path: "/inspections/13" },
    },
  };

  await runFrontendActionInterrupt(interrupt, {
    callAction: async () => ({ ok: true }),
    getFreshContext: async () => contexts.shift() ?? contexts[contexts.length - 1],
    submit: (...args: unknown[]) => {
      submitCalls.push(args);
    },
  });

  assert.equal(submitCalls.length, 1);
  assert.deepEqual(
    (submitCalls[0] as Array<{ config?: { configurable?: { pageContext?: unknown } } }>)[1]
      .config?.configurable?.pageContext,
    { readables: [{ id: "__ams_runtime_context", value: { route: "/inspections/13" } }], actions: [] },
  );
});

test("frontend action runner waits for listing visible rows after listing navigation", async () => {
  const submitCalls: unknown[] = [];
  const routeOnly = {
    readables: [{ id: "__ams_runtime_context", value: { route: "/inspections" } }],
    actions: [],
  };
  const withRows = {
    readables: [
      { id: "__ams_runtime_context", value: { route: "/inspections" } },
      {
        id: "inspection-list",
        description: "Inspections displayed on this page",
        value: { visible_rows: [{ id: 13, detail_route: "/inspections/13" }] },
      },
    ],
    actions: [],
  };
  const contexts = [routeOnly, routeOnly, withRows];

  await runFrontendActionInterrupt(
    {
      type: "frontend_action_request",
      action: {
        name: "navigate_to_route",
        args: { path: "/inspections" },
      },
    },
    {
      callAction: async () => ({ ok: true }),
      getFreshContext: async () => contexts.shift() ?? withRows,
      submit: (...args: unknown[]) => {
        submitCalls.push(args);
      },
    },
  );

  assert.equal(submitCalls.length, 1);
  assert.deepEqual(
    (submitCalls[0] as Array<{ config?: { configurable?: { pageContext?: unknown } } }>)[1]
      .config?.configurable?.pageContext,
    withRows,
  );
});

test("frontend action runner waits for active form fields after opening a form", async () => {
  const submitCalls: unknown[] = [];
  const noForm = {
    readables: [{ id: "__ams_runtime_context", value: { route: "/categories" } }],
    actions: [],
  };
  const formWithoutFields = {
    readables: [
      { id: "__ams_runtime_context", value: { route: "/categories" } },
      { id: "category-form", value: { formId: "category_create", fields: [] } },
    ],
    actions: [],
  };
  const readyForm = {
    readables: [
      { id: "__ams_runtime_context", value: { route: "/categories" } },
      {
        id: "category-form",
        value: {
          formId: "category_create",
          fields: [{ name: "name", type: "string" }],
        },
      },
    ],
    actions: [],
  };
  const contexts = [noForm, formWithoutFields, readyForm];

  await runFrontendActionInterrupt(
    {
      type: "frontend_action_request",
      action: {
        name: "open_form",
        args: { form_id: "category_create" },
      },
    },
    {
      callAction: async () => ({ ok: true }),
      getFreshContext: async () => contexts.shift() ?? readyForm,
      submit: (...args: unknown[]) => {
        submitCalls.push(args);
      },
    },
  );

  assert.equal(submitCalls.length, 1);
  assert.deepEqual(
    (submitCalls[0] as Array<{ config?: { configurable?: { pageContext?: unknown } } }>)[1]
      .config?.configurable?.pageContext,
    readyForm,
  );
});
