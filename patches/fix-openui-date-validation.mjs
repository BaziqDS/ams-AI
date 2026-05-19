/**
 * Patches @openuidev/lang-core isEmpty() so Date objects are not treated as empty.
 * Without this, DatePicker "required" validation always fails because
 * Object.keys(new Date()) returns [] and isEmpty returns true.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const target = resolve(
  root,
  "node_modules/@openuidev/lang-core/dist/index.mjs"
);

const original = readFileSync(target, "utf8");

const buggy =
  'if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0) return true;';

const fixed =
  'if (typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && Object.keys(value).length === 0) return true;';

if (!original.includes(buggy)) {
  if (original.includes(fixed)) {
    console.log("[patch] lang-core isEmpty already patched — skipping.");
  } else {
    console.warn("[patch] Could not find isEmpty pattern in lang-core — skipping.");
  }
  process.exit(0);
}

writeFileSync(target, original.replace(buggy, fixed), "utf8");

// Also patch the CJS bundle
const cjsTarget = resolve(
  root,
  "node_modules/@openuidev/lang-core/dist/index.cjs"
);
try {
  const cjsContent = readFileSync(cjsTarget, "utf8");
  if (cjsContent.includes(buggy)) {
    writeFileSync(cjsTarget, cjsContent.replace(buggy, fixed), "utf8");
  }
} catch {
  // CJS bundle may not exist, that's fine
}

console.log("[patch] Fixed lang-core isEmpty() to handle Date objects.");
