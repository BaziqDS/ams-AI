import path from "node:path";
import { fileURLToPath } from "node:url";

import { SqlDatabase } from "@langchain/classic/sql_db";
import { TavilySearch } from "@langchain/tavily";
import { tool } from "langchain";
import { DataSource, type DataSourceOptions } from "typeorm";
import { z } from "zod";

import { FRONTEND_TOOLS } from "./frontend-tools.js";
import { validateReadOnlySql } from "./sql-guard.js";
import {
  filterInspectableSqlTables,
  formatHiddenSqlTablesWarning,
} from "./sql-visibility.js";

export { filterInspectableSqlTables, formatHiddenSqlTablesWarning };

let sqlDatabase: SqlDatabase | undefined;
let sqlConnectionLabel = "";

function resolveDefaultSqlitePath() {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(
    path.dirname(thisFile),
    "../../../../../ams-backend/db.sqlite3"
  );
}

function createDataSourceOptions(): DataSourceOptions {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const url = new URL(databaseUrl);

    if (url.protocol === "postgres:" || url.protocol === "postgresql:") {
      sqlConnectionLabel = databaseUrl.replace(
        /:\/\/([^:]+):([^@]+)@/,
        "://$1:***@"
      );
      return {
        type: "postgres",
        url: databaseUrl,
      };
    }

    if (url.protocol === "sqlite:") {
      const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      sqlConnectionLabel = database;
      return {
        type: "sqlite",
        database,
      };
    }

    throw new Error(
      `Unsupported DATABASE_URL protocol "${url.protocol}". Use postgres://, postgresql://, or sqlite://.`
    );
  }

  const database =
    process.env.SQLITE_DATABASE_PATH?.trim() || resolveDefaultSqlitePath();
  sqlConnectionLabel = database;

  return {
    type: "sqlite",
    database,
  };
}

async function getSqlDatabase() {
  if (!sqlDatabase) {
    const appDataSource = new DataSource(createDataSourceOptions());
    sqlDatabase = await SqlDatabase.fromDataSourceParams({ appDataSource });
  }

  return sqlDatabase;
}

const search = tool(
  async (input) => {
    const searchTool = new TavilySearch({
      maxResults: 5,
      topic: input.topic ?? "general",
      tavilyApiKey: process.env.TAVILY_API_KEY,
    });

    return searchTool.invoke(input);
  },
  {
    name: "tavily_search",
    description:
      "A search engine optimized for comprehensive, accurate, and trusted results. Useful for answering questions about current events or external information.",
    schema: z.object({
      query: z.string().describe("The search query to run."),
      topic: z
        .enum(["general", "news", "finance"])
        .optional()
        .describe("Search topic category."),
      searchDepth: z
        .enum(["basic", "advanced"])
        .optional()
        .describe("Search depth."),
      timeRange: z
        .enum(["day", "week", "month", "year"])
        .optional()
        .describe("Optional recency filter."),
      includeImages: z
        .boolean()
        .optional()
        .describe("Whether to include image results."),
      includeDomains: z
        .array(z.string())
        .optional()
        .describe("Domains to include."),
      excludeDomains: z
        .array(z.string())
        .optional()
        .describe("Domains to exclude."),
    }),
  }
);

const getCurrentTime = tool(async () => new Date().toISOString(), {
  name: "get_current_time",
  description: "Return the current server time as an ISO timestamp.",
  schema: z.object({}),
});

const listSqlTables = tool(
  async () => {
    const db = await getSqlDatabase();
    const tableNames = db.allTables.map((table) => table.tableName);
    const { visible, hidden } = filterInspectableSqlTables(tableNames);
    const warning = formatHiddenSqlTablesWarning(hidden);

    return [
      `Connected database: ${sqlConnectionLabel}`,
      visible.length > 0
        ? `Tables: ${visible.join(", ")}`
        : "No inspectable business tables found.",
      warning,
    ]
      .filter(Boolean)
      .join("\n");
  },
  {
    name: "sql_db_list_tables",
    description:
      "List inspectable AMS business SQL tables. Internal auth/session/token/tracing tables are hidden. Always use this before asking for table schemas.",
    schema: z.object({}),
  }
);

const getSqlSchema = tool(
  async ({ table_names }) => {
    const db = await getSqlDatabase();
    const tables = table_names
      .split(",")
      .map((table) => table.trim())
      .filter(Boolean);
    const { visible, hidden } = filterInspectableSqlTables(tables);
    const parts: string[] = [];

    if (visible.length > 0) {
      parts.push(await db.getTableInfo(visible));
    }

    const warning = formatHiddenSqlTablesWarning(hidden);
    if (warning) {
      parts.push(warning);
    }

    return parts.join("\n\n") || "No inspectable table names were provided.";
  },
  {
    name: "sql_db_schema",
    description:
      "Get schema and sample rows for specific inspectable AMS business SQL tables. Internal auth/session/token/tracing tables are hidden. Input must be a comma-separated list of table names. Call sql_db_list_tables first to verify names.",
    schema: z.object({
      table_names: z
        .string()
        .describe("Comma-separated list of SQL table names."),
    }),
  }
);

/**
 * READ-ONLY SQL tool. Defense in depth:
 *  1. node-sql-parser AST check rejects anything that isn't a single SELECT.
 *  2. Hard regex rejects ATTACH/PRAGMA/VACUUM/load_extension/multi-statement.
 *  3. Tool name and description scope intent to "select" for the LLM.
 *
 * For TRUE production safety, also configure the database with a read-only
 * connection (postgres role with SELECT grant only, or SQLite mode=ro URI).
 * See README for the recommended connection-string setup.
 */
const selectFromSqlDatabase = tool(
  async ({ query }) => {
    const guard = validateReadOnlySql(query, sqlConnectionLabel);
    if (!guard.ok) {
      return `Rejected by SQL guard: ${guard.reason}`;
    }

    const db = await getSqlDatabase();
    try {
      const result = await db.run(query);
      return typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `SQL error: ${message}`;
    }
  },
  {
    name: "sql_db_select",
    description:
      "Execute a SELECT-only SQL query against the AMS database and return rows. " +
      "ONLY a single SELECT (or WITH ... SELECT) statement is permitted — INSERT, UPDATE, " +
      "DELETE, DROP, CREATE, ALTER, TRUNCATE, PRAGMA and other write/DDL statements are " +
      "rejected by a parser BEFORE execution. Do NOT attempt to chain statements with " +
      "semicolons. Internal auth/session/token/tracing tables are blocked. Do NOT query " +
      "password hashes, sessions, tokens, or tracing/request logs. " +
      "For data modifications you MUST use the frontend tools " +
      "(set_form_values, request_form_submit, or an allowed registered page action) so the user reviews and " +
      "approves the change through the AMS UI. Do not guess table names or column names. " +
      "For broad database questions, call sql_db_list_tables, then sql_db_schema for every " +
      "business table in the query before calling this tool. Include LIMIT for non-aggregate " +
      "list queries.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "A single SELECT (or WITH ... SELECT) statement. No semicolons. No multi-statement. " +
            "If you need to update data, return a chat reply telling the user and use the " +
            "frontend form tools instead."
        ),
    }),
  }
);

export const TOOLS = [
  search,
  getCurrentTime,
  listSqlTables,
  getSqlSchema,
  selectFromSqlDatabase,
  ...FRONTEND_TOOLS,
];
