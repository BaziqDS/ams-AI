import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAmsSqlDataSourceOptions,
  resolveAmsSqliteDefaultPath,
} from "./sql-tools.js";

test("SQL analyst uses configured PostgreSQL database URL", () => {
  const previous = process.env.AMS_SQL_DATABASE_URL;
  process.env.AMS_SQL_DATABASE_URL = "postgresql://user:pass@localhost:5432/ams";

  try {
    assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
      type: "postgres",
      url: "postgresql://user:pass@localhost:5432/ams",
    });
  } finally {
    if (previous === undefined) {
      delete process.env.AMS_SQL_DATABASE_URL;
    } else {
      process.env.AMS_SQL_DATABASE_URL = previous;
    }
  }
});

test("SQL analyst normalizes Django-style PostgreSQL database URL", () => {
  const previous = process.env.AMS_SQL_DATABASE_URL;
  process.env.AMS_SQL_DATABASE_URL =
    "postgresql+psycopg2://user:pass@localhost:5432/ams";

  try {
    assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
      type: "postgres",
      url: "postgresql://user:pass@localhost:5432/ams",
    });
  } finally {
    if (previous === undefined) {
      delete process.env.AMS_SQL_DATABASE_URL;
    } else {
      process.env.AMS_SQL_DATABASE_URL = previous;
    }
  }
});

test("SQL analyst falls back to SQLite database path", () => {
  const previousUrl = process.env.AMS_SQL_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSqlitePath = process.env.SQLITE_DATABASE_PATH;
  delete process.env.AMS_SQL_DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.SQLITE_DATABASE_PATH = "C:/ams/db.sqlite3";

  try {
    assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
      type: "sqlite",
      database: "C:/ams/db.sqlite3",
    });
  } finally {
    if (previousUrl === undefined) delete process.env.AMS_SQL_DATABASE_URL;
    else process.env.AMS_SQL_DATABASE_URL = previousUrl;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previousSqlitePath;
  }
});

test("SQL analyst falls back to the existing AMS backend SQLite database", () => {
  const previousUrl = process.env.AMS_SQL_DATABASE_URL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSqlitePath = process.env.SQLITE_DATABASE_PATH;
  delete process.env.AMS_SQL_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SQLITE_DATABASE_PATH;

  try {
    assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
      type: "sqlite",
      database: resolveAmsSqliteDefaultPath(),
    });
  } finally {
    if (previousUrl === undefined) delete process.env.AMS_SQL_DATABASE_URL;
    else process.env.AMS_SQL_DATABASE_URL = previousUrl;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSqlitePath === undefined) delete process.env.SQLITE_DATABASE_PATH;
    else process.env.SQLITE_DATABASE_PATH = previousSqlitePath;
  }
});
