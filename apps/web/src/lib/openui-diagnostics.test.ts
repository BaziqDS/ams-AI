import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenUiRepairPrompt,
  formatOpenUiErrors,
  openUiDiagnosticKey,
} from "./openui-diagnostics.js";

test("formats renderer errors with code, statement, and hint", () => {
  const diagnostics = formatOpenUiErrors([
    {
      type: "validation",
      source: "parser",
      code: "unknown-component",
      message: "Unknown component Grid",
      statementId: "layout",
      hint: "Use Stack instead",
    },
  ]);

  assert.equal(
    diagnostics,
    '[parser] "layout": unknown-component: Unknown component Grid Hint: Use Stack instead',
  );
});

test("builds hidden repair prompt with diagnostics and original code", () => {
  const prompt = buildOpenUiRepairPrompt({
    diagnostics: "Unresolved references: card",
    code: "root = Stack([card])",
  });

  assert.match(prompt, /^OPENUI_RENDERER_REPAIR_REQUEST/);
  assert.match(prompt, /valid OpenUI only/);
  assert.match(prompt, /Unresolved references: card/);
  assert.match(prompt, /```openui\nroot = Stack\(\[card\]\)\n```/);
});

test("diagnostic key is scoped by message id", () => {
  assert.notEqual(
    openUiDiagnosticKey("m1", "same diagnostic"),
    openUiDiagnosticKey("m2", "same diagnostic"),
  );
});
