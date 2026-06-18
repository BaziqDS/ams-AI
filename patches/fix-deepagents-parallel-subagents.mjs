/**
 * Patches deepagents so its built-in `task`-tool guidance stops pushing the
 * orchestrator to launch subagents in parallel.
 *
 * Root cause of the "frontend_controller is called twice" bug:
 * deepagents' createSubAgentMiddleware injects two pieces of hard-coded text
 * into the orchestrator that actively encourage firing several `task` calls in
 * a single turn:
 *
 *   1. getTaskToolDescription() — the `task` tool description:
 *        "Launch multiple agents concurrently whenever possible, to maximize
 *         performance; to do that, use a single message with multiple tool uses"
 *   2. TASK_SYSTEM_PROMPT — appended to the orchestrator system prompt:
 *        "Whenever possible, parallelize the work that you do ... kick off tasks
 *         (subagents) in parallel to accomplish them faster."
 *
 * These directly contradict the AMS orchestrator prompt's
 * "ONE DELEGATION AT A TIME — NO PARALLEL" rule. Under the conflicting
 * pressure the model emits two task(subagent_type="frontend_controller") calls
 * in one turn; serialTaskGuard then defers the second and instructs the model
 * to re-issue it, so the single live browser subagent runs TWICE.
 *
 * createDeepAgent exposes no override for this text: harnessProfile
 * toolDescriptionOverrides only apply to user-supplied tools, and the `task`
 * tool is built internally inside createSubAgentMiddleware (called with no
 * taskDescription/systemPrompt override). So the fix has to live in the
 * vendored dist, same as fix-deepagents-state-leak.mjs.
 *
 * This patch rewrites the two distinctive sentences to demand strictly serial
 * subagent execution. It matches on the sentence text only (not surrounding
 * whitespace) and is idempotent. If deepagents is upgraded, re-run/verify it
 * still matches; remove it once upstream stops hard-coding parallel guidance.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Each replacement: a distinctive `find` sentence + its serial `replace`.
// `find` is matched literally (no regex), so it survives whitespace/format
// differences in the surrounding template literal.
const REPLACEMENTS = [
  {
    label: "task-tool description usage note",
    find:
      "Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses",
    replace:
      "Launch exactly ONE subagent at a time. NEVER launch multiple subagents (task calls) in parallel in a single message — parallel subagents share the user's single live session and their results collide and corrupt each other. Issue one task call, wait for its result, then decide the next step",
  },
  {
    label: "TASK_SYSTEM_PROMPT parallelize bullet",
    find:
      "Whenever possible, parallelize the work that you do. This is true for both tool_calls, and for tasks. Whenever you have independent steps to complete - make tool_calls, or kick off tasks (subagents) in parallel to accomplish them faster. This saves time for the user, which is incredibly important.",
    replace:
      "Run subagents strictly ONE AT A TIME. Never kick off multiple tasks (subagents) in parallel in a single turn: issue one task call, wait for its result, then decide the next step. Parallel subagents collide on shared live-session state and corrupt each other's work.",
  },
  {
    label: "task-tool 'when to use' parallel bullet",
    find: "When a task is independent of other tasks and can run in parallel",
    replace:
      "When a task is independent of other tasks (run it on its own, never alongside other task calls in the same turn)",
  },
];

const candidates = [
  "node_modules/deepagents/dist/index.js",
  "node_modules/deepagents/dist/index.cjs",
  "apps/agents/node_modules/deepagents/dist/index.js",
  "apps/agents/node_modules/deepagents/dist/index.cjs",
].map((p) => resolve(root, p));

let filesPatched = 0;
let filesAlreadyPatched = 0;

for (const target of candidates) {
  if (!existsSync(target)) continue;

  let contents = readFileSync(target, "utf8");
  let changedThisFile = 0;
  let alreadyThisFile = 0;

  for (const { label, find, replace } of REPLACEMENTS) {
    if (contents.includes(replace)) {
      alreadyThisFile += 1;
      continue;
    }
    if (!contents.includes(find)) {
      console.warn(
        `[patch] '${label}' string not found in ${target} — skipping (deepagents may have changed).`,
      );
      continue;
    }
    contents = contents.split(find).join(replace);
    changedThisFile += 1;
  }

  if (changedThisFile > 0) {
    writeFileSync(target, contents, "utf8");
    filesPatched += 1;
    console.log(
      `[patch] Removed parallel-subagent guidance (${changedThisFile} string(s)) in ${target}`,
    );
  } else if (alreadyThisFile === REPLACEMENTS.length) {
    filesAlreadyPatched += 1;
  }
}

if (filesPatched === 0 && filesAlreadyPatched === 0) {
  console.warn(
    "[patch] No deepagents dist files patched for parallel-subagent guidance — nothing matched.",
  );
} else if (filesPatched === 0) {
  console.log(
    "[patch] deepagents parallel-subagent guidance already patched — skipping.",
  );
} else {
  console.log(
    `[patch] Fixed deepagents parallel-subagent guidance (${filesPatched} file(s)).`,
  );
}
