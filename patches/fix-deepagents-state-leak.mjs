/**
 * Patches deepagents EXCLUDED_STATE_KEYS so toolCallLimitMiddleware counters
 * (threadToolCallCount / runToolCallCount) do not propagate between the parent
 * agent and subagents through the `task` tool.
 *
 * Without this:
 * 1. Two parallel `task` calls both write threadToolCallCount into the parent
 *    graph in the same step -> InvalidUpdateError ("LastValue can only receive
 *    one value per step") and the run crashes.
 * 2. A finished subagent's afterAgent hook resets runToolCallCount to {},
 *    which overwrites the parent's counter -> the parent's runLimit never trips.
 * 3. New subagents inherit the parent's live counters -> they can start at the
 *    limit and have every tool call blocked immediately.
 *
 * Upstream tracking: https://github.com/langchain-ai/deepagentsjs/issues/65
 * (same bug class, fixed upstream for "todos" via this same exclusion list).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const MARKER = "const EXCLUDED_STATE_KEYS = [";
const ADDED_KEYS = ["threadToolCallCount", "runToolCallCount"];

const candidates = [
  "node_modules/deepagents/dist/index.js",
  "node_modules/deepagents/dist/index.cjs",
  "apps/agents/node_modules/deepagents/dist/index.js",
  "apps/agents/node_modules/deepagents/dist/index.cjs",
].map((p) => resolve(root, p));

let patched = 0;
let alreadyPatched = 0;

for (const target of candidates) {
  if (!existsSync(target)) continue;

  const original = readFileSync(target, "utf8");
  const start = original.indexOf(MARKER);
  if (start === -1) {
    console.warn(`[patch] EXCLUDED_STATE_KEYS not found in ${target} — skipping.`);
    continue;
  }
  const end = original.indexOf("];", start);
  if (end === -1) {
    console.warn(`[patch] Could not find end of EXCLUDED_STATE_KEYS in ${target} — skipping.`);
    continue;
  }

  const block = original.slice(start, end);
  if (ADDED_KEYS.every((key) => block.includes(`"${key}"`))) {
    alreadyPatched += 1;
    continue;
  }

  const insertion = ADDED_KEYS.filter((key) => !block.includes(`"${key}"`))
    .map((key) => `,\n\t"${key}"`)
    .join("");
  const updated = `${original.slice(0, end).replace(/[\s,]+$/, "")}${insertion}\n${original.slice(end)}`;
  writeFileSync(target, updated, "utf8");
  patched += 1;
  console.log(`[patch] Excluded tool-call counters from subagent state in ${target}`);
}

if (patched === 0 && alreadyPatched === 0) {
  console.warn("[patch] No deepagents dist files found — nothing patched.");
} else if (patched === 0) {
  console.log("[patch] deepagents state leak already patched — skipping.");
} else {
  console.log(`[patch] Fixed deepagents subagent state leak (${patched} file(s)).`);
}
