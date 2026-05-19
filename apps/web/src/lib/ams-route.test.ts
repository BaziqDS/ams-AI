import assert from "node:assert/strict";
import test from "node:test";

import { isAmsRelativeRoute } from "./ams-route";

test("detects safe AMS relative routes", () => {
  assert.equal(isAmsRelativeRoute("/inspections"), true);
  assert.equal(isAmsRelativeRoute("/stock-entries/1?mode=edit"), true);
  assert.equal(isAmsRelativeRoute("https://example.com"), false);
  assert.equal(isAmsRelativeRoute("//example.com"), false);
  assert.equal(isAmsRelativeRoute("javascript:alert(1)"), false);
});
