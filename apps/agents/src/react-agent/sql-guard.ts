import sqlParser from "node-sql-parser";

import { findSensitiveSqlTableReferences } from "./sql-visibility.js";

const parser = new sqlParser.Parser();

/**
 * Statement AST types we allow. SELECT and WITH...SELECT both surface as
 * type "select" in node-sql-parser. Everything else (insert/update/delete/
 * drop/create/alter/truncate/replace/grant/revoke/rename/copy/call/use/begin/
 * commit/savepoint/pragma/attach/vacuum/analyze...) is rejected.
 */
const ALLOWED_AST_TYPES = new Set(["select"]);

/**
 * Defensive patterns. The AST check is the primary gate, but we also reject a
 * few raw-string smells before parsing — multi-statement smuggling, common
 * pragma/attach noise that some parsers tolerate, and SQLite's CTE write
 * idioms.
 */
const HARD_REJECT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\battach\s+database\b/i, label: "ATTACH DATABASE" },
  { re: /\bdetach\s+database\b/i, label: "DETACH DATABASE" },
  { re: /\bpragma\b/i, label: "PRAGMA (SQLite engine control)" },
  { re: /\bvacuum\b/i, label: "VACUUM" },
  { re: /\bload_extension\s*\(/i, label: "load_extension()" },
];

export type SqlDialect = "SQLite" | "PostgresQL" | "MySQL" | "MariaDB";

export type GuardResult = { ok: true } | { ok: false; reason: string };

function detectDialect(label: string): SqlDialect {
  const lower = label.toLowerCase();
  if (lower.includes("postgres")) return "PostgresQL";
  if (lower.includes("mysql")) return "MySQL";
  if (lower.includes("mariadb")) return "MariaDB";
  return "SQLite";
}

export function validateReadOnlySql(
  query: string,
  connectionLabel = ""
): GuardResult {
  const trimmed = query.trim().replace(/;+\s*$/u, "");
  if (!trimmed) {
    return { ok: false, reason: "Empty query." };
  }

  for (const { re, label } of HARD_REJECT_PATTERNS) {
    if (re.test(trimmed)) {
      return {
        ok: false,
        reason: `${label} is not allowed. This tool is restricted to read-only SELECT queries.`,
      };
    }
  }

  // Reject if a semicolon appears anywhere other than the (already stripped)
  // trailing position — multi-statement smuggling.
  if (trimmed.includes(";")) {
    return {
      ok: false,
      reason: "Multiple statements are not allowed. Submit a single SELECT.",
    };
  }

  const dialect = detectDialect(connectionLabel);

  let asts: ReturnType<typeof parser.astify>;
  try {
    asts = parser.astify(trimmed, { database: dialect });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `SQL parse error: ${message}. Only SELECT is allowed.`,
    };
  }

  const statements = Array.isArray(asts) ? asts : [asts];
  if (statements.length === 0) {
    return { ok: false, reason: "No statement found in the query." };
  }
  if (statements.length > 1) {
    return {
      ok: false,
      reason: "Multiple statements are not allowed. Submit a single SELECT.",
    };
  }

  const stmt = statements[0] as { type?: string } | null;
  const type = String(stmt?.type ?? "").toLowerCase();

  if (!ALLOWED_AST_TYPES.has(type)) {
    return {
      ok: false,
      reason:
        `Statement type "${type || "unknown"}" is not allowed. ` +
        "Database access is READ-ONLY through this tool — only SELECT statements are permitted. " +
        "For data modifications, use the frontend form tools (set_form_values, " +
        "request_form_submit, or an allowed registered page action) so the user reviews and submits through the AMS UI.",
    };
  }

  const sensitiveTables = findSensitiveSqlTableReferences(trimmed);
  if (sensitiveTables.length > 0) {
    return {
      ok: false,
      reason:
        "This query references internal or sensitive AMS tables. " +
        "SQL tools are restricted to operational business data; use AMS page context, frontend actions, or safe application APIs instead.",
    };
  }

  return { ok: true };
}
