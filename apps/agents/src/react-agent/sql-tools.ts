import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SqlToolkit } from "@langchain/classic/agents/toolkits/sql";
import { SqlDatabase } from "@langchain/classic/sql_db";
import type { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import { DynamicTool } from "@langchain/core/tools";
import type { StructuredTool } from "langchain";
import { DataSource, type DataSourceOptions } from "typeorm";

const DEFAULT_AMS_SQLITE_PATH = fileURLToPath(
  new URL("../../../../../ams-backend/db.sqlite3", import.meta.url),
);

// node-sqlite3 OPEN_READONLY flag. The agent connection must never be able to
// write, regardless of what SQL slips past the query guard.
const SQLITE_OPEN_READONLY = 1;

const DEFAULT_STATEMENT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESULT_ROWS = 200;
const MAX_RESULT_CHARS = 20_000;

// Business tables the SQL analyst is allowed to see and query. Everything
// else (auth_*, django_*, silk_*, token_blacklist_*, sqlite internals) is
// invisible to the agent and rejected at query time.
const ALLOWED_TABLE_PREFIXES = [
  "inventory_",
  "notifications_",
  "user_management_",
];

// Column names that must never appear in agent SQL, even if an operator
// extends the table allowlist (e.g. adds auth_user for display names).
const DENIED_COLUMN_NAMES = [
  "password",
  "session_key",
  "session_data",
  "secret",
  "salt",
];

// Table-valued functions that are legitimate in FROM/JOIN position for
// analytics SQL (date spines, array/JSON expansion). Any other function used
// as a row source is rejected.
const ALLOWED_FROM_FUNCTIONS = new Set([
  // Postgres
  "generate_series",
  "unnest",
  "json_each",
  "json_each_text",
  "jsonb_each",
  "jsonb_each_text",
  "json_array_elements",
  "json_array_elements_text",
  "jsonb_array_elements",
  "jsonb_array_elements_text",
  "regexp_split_to_table",
  "string_to_table",
  // SQLite (JSON1)
  "json_tree",
]);

// Functions that can read files, control sessions, reach other databases, or
// stall the connection. Rejected anywhere in the statement, defense in depth
// on top of the low-privilege database role.
const DENIED_FUNCTION_PATTERN =
  /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|lo_import|lo_export|set_config|dblink\w*|pg_advisory\w*|readfile|writefile)\s*\(/i;

// Keywords that have no place in a read-only SELECT. Word-boundary matched,
// so created_at / updated_at / offset are unaffected.
const DENIED_SQL_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "create",
  "truncate",
  "grant",
  "revoke",
  "attach",
  "detach",
  "pragma",
  "vacuum",
  "reindex",
  "copy",
  "merge",
  "call",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "into",
  "load_extension",
];

function sqlitePathFromUrl(url: string) {
  if (url.startsWith("sqlite:///")) return url.slice("sqlite:///".length);
  if (url.startsWith("sqlite://")) return url.slice("sqlite://".length);
  return null;
}

function postgresUrlFromUrl(url: string) {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return url;
  }
  if (url.startsWith("postgresql+psycopg2://")) {
    return `postgresql://${url.slice("postgresql+psycopg2://".length)}`;
  }
  return null;
}

function configuredSqlitePath() {
  const sqliteDatabasePath = process.env.SQLITE_DATABASE_PATH?.trim();
  if (sqliteDatabasePath) return sqliteDatabasePath;
  if (existsSync(DEFAULT_AMS_SQLITE_PATH)) return DEFAULT_AMS_SQLITE_PATH;
  return null;
}

function configuredPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function configuredStatementTimeoutMs() {
  return configuredPositiveInt(
    process.env.AMS_SQL_STATEMENT_TIMEOUT_MS,
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
}

function configuredMaxResultRows() {
  return configuredPositiveInt(
    process.env.AMS_SQL_MAX_RESULT_ROWS,
    DEFAULT_MAX_RESULT_ROWS,
  );
}

export function resolveAmsSqlDataSourceOptions(): DataSourceOptions {
  const databaseUrl =
    process.env.AMS_SQL_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const sqlitePath = sqlitePathFromUrl(databaseUrl);
    if (sqlitePath) {
      return {
        type: "sqlite",
        database: sqlitePath,
        flags: SQLITE_OPEN_READONLY,
      };
    }

    const postgresUrl = postgresUrlFromUrl(databaseUrl);
    if (postgresUrl) {
      return {
        type: "postgres",
        url: postgresUrl,
        extra: {
          options: `-c default_transaction_read_only=on -c statement_timeout=${configuredStatementTimeoutMs()}`,
        },
      };
    }
  }

  const sqliteDatabasePath = configuredSqlitePath();
  if (sqliteDatabasePath) {
    return {
      type: "sqlite",
      database: sqliteDatabasePath,
      flags: SQLITE_OPEN_READONLY,
    };
  }

  throw new Error(
    "AMS SQL database is not configured. Set AMS_SQL_DATABASE_URL, DATABASE_URL, or SQLITE_DATABASE_PATH.",
  );
}

export function resolveAmsSqliteDefaultPath() {
  return DEFAULT_AMS_SQLITE_PATH;
}

export function resolveAllowedTables(knownTables: string[]): string[] {
  const override = process.env.AMS_SQL_ALLOWED_TABLES?.trim();
  const known = new Set(knownTables);
  const allowed = override
    ? override
        .split(",")
        .map((table) => table.trim())
        .filter((table) => table.length > 0 && known.has(table))
    : knownTables.filter((table) =>
        ALLOWED_TABLE_PREFIXES.some((prefix) => table.startsWith(prefix)),
      );

  if (allowed.length === 0) {
    throw new Error(
      "No AMS tables are allowed for the SQL analyst. Check AMS_SQL_ALLOWED_TABLES or the database connection.",
    );
  }
  return allowed;
}

// Removes string literals and comments so keyword / identifier scanning
// cannot be confused by user-provided text like WHERE name = 'drop off'.
function stripLiteralsAndComments(query: string) {
  return query
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

function collectCteNames(strippedQuery: string) {
  const names = new Set<string>();
  for (const match of strippedQuery.matchAll(/\b([a-zA-Z_]\w*)\s+as\s*\(/gi)) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

// Scans every FROM/JOIN row source and classifies it as a table reference or
// a function call (identifier directly followed by an opening parenthesis).
// LATERAL is skipped so `JOIN LATERAL generate_series(...)` resolves to the
// function, and schema qualifiers are dropped (public.foo -> foo).
function collectRowSources(strippedQuery: string) {
  const tables = new Set<string>();
  const functions = new Set<string>();
  for (const match of strippedQuery.matchAll(
    /\b(?:from|join)\s+(?:lateral\s+)?["'`[]?([a-zA-Z_][\w.]*)["'`\]]?\s*(\()?/gi,
  )) {
    const identifier = match[1].toLowerCase();
    const segments = identifier.split(".");
    const name = segments[segments.length - 1];
    if (match[2] === "(") functions.add(name);
    else tables.add(name);
  }
  return { tables, functions };
}

export type SqlQueryVerdict =
  | { ok: true; query: string }
  | { ok: false; reason: string };

export function validateSqlAnalystQuery(
  query: string,
  {
    allowedTables,
    knownTables,
    maxRows = DEFAULT_MAX_RESULT_ROWS,
  }: { allowedTables: string[]; knownTables: string[]; maxRows?: number },
): SqlQueryVerdict {
  const stripped = stripLiteralsAndComments(query);
  const normalized = stripped.trim().replace(/;+\s*$/, "");

  if (normalized.length === 0) {
    return { ok: false, reason: "Empty query." };
  }
  if (normalized.includes(";")) {
    return { ok: false, reason: "Only a single SQL statement is allowed." };
  }
  if (!/^(select|with)\b/i.test(normalized)) {
    return {
      ok: false,
      reason: "Only read-only SELECT (or WITH … SELECT) statements are allowed.",
    };
  }

  for (const keyword of DENIED_SQL_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(normalized)) {
      return {
        ok: false,
        reason: `Statement contains forbidden keyword "${keyword.toUpperCase()}". Only read-only SELECT queries are allowed.`,
      };
    }
  }

  for (const column of DENIED_COLUMN_NAMES) {
    if (new RegExp(`\\b${column}\\b`, "i").test(normalized)) {
      return {
        ok: false,
        reason: `Column "${column}" is sensitive and cannot be queried.`,
      };
    }
  }

  const deniedFunction = normalized.match(DENIED_FUNCTION_PATTERN);
  if (deniedFunction) {
    return {
      ok: false,
      reason: `Function "${deniedFunction[1]}" is not allowed.`,
    };
  }

  const allowedSet = new Set(allowedTables.map((table) => table.toLowerCase()));
  const cteNames = collectCteNames(normalized);
  const { tables, functions } = collectRowSources(normalized);
  for (const table of tables) {
    if (cteNames.has(table)) continue;
    if (!allowedSet.has(table)) {
      return {
        ok: false,
        reason: `Table "${table}" is not in the allowed table list. Use list-tables-sql to see queryable tables.`,
      };
    }
  }
  for (const fn of functions) {
    if (!ALLOWED_FROM_FUNCTIONS.has(fn)) {
      return {
        ok: false,
        reason: `Function "${fn}" is not allowed as a FROM/JOIN row source. Allowed table functions: ${[...ALLOWED_FROM_FUNCTIONS].join(", ")}.`,
      };
    }
  }

  // Catch disallowed tables referenced outside FROM/JOIN (e.g. odd subquery
  // shapes) by scanning for any known-but-forbidden table name.
  for (const table of knownTables) {
    const lowered = table.toLowerCase();
    if (allowedSet.has(lowered)) continue;
    if (new RegExp(`\\b${lowered}\\b`, "i").test(normalized)) {
      return {
        ok: false,
        reason: `Table "${table}" is not accessible to the SQL analyst.`,
      };
    }
  }

  let executable = query.trim().replace(/;+\s*$/, "");
  if (!/\blimit\s+\d+/i.test(normalized)) {
    executable = `${executable} LIMIT ${maxRows}`;
  }
  return { ok: true, query: executable };
}

function createGuardedQuerySqlTool(
  db: SqlDatabase,
  allowedTables: string[],
  knownTables: string[],
) {
  const maxRows = configuredMaxResultRows();
  return new DynamicTool({
    name: "query-sql",
    description: `Input to this tool is a detailed and correct read-only SQL SELECT query, output is a result from the database.
  Only these tables are queryable: ${allowedTables.join(", ")}.
  Write statements and DDL are rejected, sensitive columns are blocked, and results are capped at ${maxRows} rows.
  If the query is not correct, an error message will be returned.
  If an error is returned, rewrite the query, check the query, and try again.`,
    func: async (input: string) => {
      const verdict = validateSqlAnalystQuery(input, {
        allowedTables,
        knownTables,
        maxRows,
      });
      if (!verdict.ok) {
        return `Query rejected: ${verdict.reason}`;
      }
      try {
        const result = await db.run(verdict.query);
        if (result.length > MAX_RESULT_CHARS) {
          return `${result.slice(0, MAX_RESULT_CHARS)}\n[Result truncated at ${MAX_RESULT_CHARS} characters — narrow the query or aggregate.]`;
        }
        return result;
      } catch (error) {
        return `${error}`;
      }
    },
  });
}

// SqlDatabase.getTableInfo(targetTables) validates against ALL tables, not
// includesTables, so the stock info-sql tool can leak schema and sample rows
// of hidden tables (e.g. auth_user password hashes). This wrapper enforces
// the allowlist before delegating.
function createGuardedInfoSqlTool(db: SqlDatabase, allowedTables: string[]) {
  const allowedSet = new Set(allowedTables);
  return new DynamicTool({
    name: "info-sql",
    description: `Input to this tool is a comma-separated list of tables, output is the schema and sample rows for those tables.
    Be sure that the tables actually exist by calling list-tables-sql first!

    Example Input: "table1, table2, table3.`,
    func: async (input: string) => {
      const tables = input
        .split(",")
        .map((table) => table.trim())
        .filter((table) => table.length > 0);
      const denied = tables.filter((table) => !allowedSet.has(table));
      if (denied.length > 0) {
        return `Schema access rejected for: ${denied.join(", ")}. Use list-tables-sql to see the queryable tables.`;
      }
      try {
        return await db.getTableInfo(tables);
      } catch (error) {
        return `${error}`;
      }
    },
  });
}

export async function createSqlAnalystTools(
  llm: BaseLanguageModelInterface,
): Promise<StructuredTool[]> {
  const dataSource = new DataSource(resolveAmsSqlDataSourceOptions());
  const db = await SqlDatabase.fromDataSourceParams({
    appDataSource: dataSource,
  });

  const knownTables = db.allTables.map((table) => table.tableName);
  const allowedTables = resolveAllowedTables(knownTables);
  // list-tables-sql and info-sql read includesTables at call time, so setting
  // it here hides non-business tables from schema discovery.
  db.includesTables = allowedTables;

  const toolkitTools = new SqlToolkit(db, llm)
    .tools as unknown as StructuredTool[];
  return toolkitTools.map((tool) => {
    if (tool.name === "query-sql") {
      return createGuardedQuerySqlTool(
        db,
        allowedTables,
        knownTables,
      ) as unknown as StructuredTool;
    }
    if (tool.name === "info-sql") {
      return createGuardedInfoSqlTool(
        db,
        allowedTables,
      ) as unknown as StructuredTool;
    }
    return tool;
  });
}
