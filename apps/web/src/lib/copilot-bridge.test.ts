import assert from "node:assert/strict";
import test from "node:test";
import { CopilotBridge } from "./copilot-bridge";

type Listener = (event: MessageEvent) => void;

function runtimeContext(route: string) {
  return {
    readables: [
      {
        id: "__ams_runtime_context",
        description: "Current AMS route",
        value: { route },
      },
    ],
    actions: [],
  };
}

function installFakeWindow(nextRoute: string) {
  const listeners = new Map<string, Listener>();
  const parent = {
    postMessage(message: unknown) {
      const data = message as { source?: string; type?: string };
      if (
        data.source === "ams-copilot-iframe" &&
        data.type === "REQUEST_CONTEXT"
      ) {
        queueMicrotask(() => {
          listeners.get("message")?.({
            origin: "http://ams.test",
            data: {
              source: "ams-copilot",
              type: "CONTEXT_UPDATE",
              ...runtimeContext(nextRoute),
            },
          } as MessageEvent);
        });
      }
    },
  };

  const fakeWindow = {
    parent,
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    dispatchEvent() {
      return true;
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  return fakeWindow;
}

test("getFreshContext resolves with the latest parent route instead of cached route", async () => {
  const bridge = new CopilotBridge();
  installFakeWindow("/locations");

  bridge.init();
  bridge.ingestContextUpdate(runtimeContext("/categories"));

  const context = await bridge.getFreshContext();
  const runtime = context.readables.find(
    (readable) => readable.id === "__ams_runtime_context",
  );

  assert.deepEqual(runtime?.value, { route: "/locations" });
});

test("getFreshContext can reject instead of silently returning stale context", async () => {
  const listeners = new Map<string, Listener>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      parent: {
        postMessage() {
          // Simulate a parent shell that does not answer REQUEST_CONTEXT.
        },
      },
      addEventListener(type: string, listener: Listener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
      dispatchEvent() {
        return true;
      },
    },
  });

  const bridge = new CopilotBridge();
  bridge.init();
  bridge.ingestContextUpdate(runtimeContext("/stale"));

  await assert.rejects(
    bridge.getFreshContext({ timeoutMs: 1, requireFresh: true }),
    /Fresh AMS page context/,
  );
});

test("requestVoiceCapture asks the parent AMS shell to start voice mode", () => {
  const postedMessages: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      parent: {
        postMessage(message: unknown) {
          postedMessages.push(message);
        },
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    },
  });

  const bridge = new CopilotBridge();

  assert.equal(bridge.requestVoiceCapture(), true);
  assert.deepEqual(postedMessages, [
    { source: "ams-copilot-iframe", type: "START_VOICE_CAPTURE" },
  ]);
});
