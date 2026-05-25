import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SqlToolkit } from "@langchain/classic/agents/toolkits/sql";
import { SqlDatabase } from "@langchain/classic/sql_db";
import type { BaseLanguageModelInterface } from "@langchain/core/language_models/base";
import type { StructuredTool } from "langchain";
import { DataSource, type DataSourceOptions } from "typeorm";

const DEFAULT_AMS_SQLITE_PATH = fileURLToPath(
  new URL("../../../../../ams-backend/db.sqlite3", import.meta.url),
);

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

export function resolveAmsSqlDataSourceOptions(): DataSourceOptions {
  const databaseUrl =
    process.env.AMS_SQL_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const sqlitePath = sqlitePathFromUrl(databaseUrl);
    if (sqlitePath) {
      return {
        type: "sqlite",
        database: sqlitePath,
      };
    }

    const postgresUrl = postgresUrlFromUrl(databaseUrl);
    if (postgresUrl) {
      return {
        type: "postgres",
        url: postgresUrl,
      };
    }
  }

  const sqliteDatabasePath = configuredSqlitePath();
  if (sqliteDatabasePath) {
    return {
      type: "sqlite",
      database: sqliteDatabasePath,
    };
  }

  throw new Error(
    "AMS SQL database is not configured. Set AMS_SQL_DATABASE_URL, DATABASE_URL, or SQLITE_DATABASE_PATH.",
  );
}

export function resolveAmsSqliteDefaultPath() {
  return DEFAULT_AMS_SQLITE_PATH;
}

export async function createSqlAnalystTools(
  llm: BaseLanguageModelInterface,
): Promise<StructuredTool[]> {
  const dataSource = new DataSource(resolveAmsSqlDataSourceOptions());
  const db = await SqlDatabase.fromDataSourceParams({
    appDataSource: dataSource,
  });
  return new SqlToolkit(db, llm).tools as unknown as StructuredTool[];
}
