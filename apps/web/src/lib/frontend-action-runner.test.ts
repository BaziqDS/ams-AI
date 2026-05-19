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
