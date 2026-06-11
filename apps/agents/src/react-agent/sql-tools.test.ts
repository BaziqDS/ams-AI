import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAllowedTables,
  resolveAmsSqlDataSourceOptions,
  resolveAmsSqliteDefaultPath,
  validateSqlAnalystQuery,
} from "./sql-tools.js";

const SQLITE_OPEN_READONLY = 1;

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("SQL analyst uses configured PostgreSQL database URL with read-only session", () => {
  withEnv(
    {
      AMS_SQL_DATABASE_URL: "postgresql://user:pass@localhost:5432/ams",
      AMS_SQL_STATEMENT_TIMEOUT_MS: undefined,
    },
    () => {
      assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
        type: "postgres",
        url: "postgresql://user:pass@localhost:5432/ams",
        extra: {
          options:
            "-c default_transaction_read_only=on -c statement_timeout=8000",
        },
      });
    },
  );
});

test("SQL analyst normalizes Django-style PostgreSQL database URL", () => {
  withEnv(
    {
      AMS_SQL_DATABASE_URL: "postgresql+psycopg2://user:pass@localhost:5432/ams",
      AMS_SQL_STATEMENT_TIMEOUT_MS: undefined,
    },
    () => {
      assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
        type: "postgres",
        url: "postgresql://user:pass@localhost:5432/ams",
        extra: {
          options:
            "-c default_transaction_read_only=on -c statement_timeout=8000",
        },
      });
    },
  );
});

test("SQL analyst falls back to SQLite database path opened read-only", () => {
  withEnv(
    {
      AMS_SQL_DATABASE_URL: undefined,
      DATABASE_URL: undefined,
      SQLITE_DATABASE_PATH: "C:/ams/db.sqlite3",
    },
    () => {
      assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
        type: "sqlite",
        database: "C:/ams/db.sqlite3",
        flags: SQLITE_OPEN_READONLY,
      });
    },
  );
});

test("SQL analyst falls back to the existing AMS backend SQLite database", () => {
  withEnv(
    {
      AMS_SQL_DATABASE_URL: undefined,
      DATABASE_URL: undefined,
      SQLITE_DATABASE_PATH: undefined,
    },
    () => {
      assert.deepEqual(resolveAmsSqlDataSourceOptions(), {
        type: "sqlite",
        database: resolveAmsSqliteDefaultPath(),
        flags: SQLITE_OPEN_READONLY,
      });
    },
  );
});

const KNOWN_TABLES = [
  "auth_user",
  "django_session",
  "token_blacklist_outstandingtoken",
  "silk_request",
  "inventory_item",
  "inventory_location",
  "inventory_inspectionitem",
  "notifications_usernotification",
  "user_management_userprofile",
];

test("allowed tables default to business prefixes only", () => {
  withEnv({ AMS_SQL_ALLOWED_TABLES: undefined }, () => {
    assert.deepEqual(resolveAllowedTables(KNOWN_TABLES), [
      "inventory_item",
      "inventory_location",
      "inventory_inspectionitem",
      "notifications_usernotification",
      "user_management_userprofile",
    ]);
  });
});

test("allowed tables can be overridden via env and ignore unknown names", () => {
  withEnv(
    { AMS_SQL_ALLOWED_TABLES: "inventory_item, no_such_table ,auth_user" },
    () => {
      assert.deepEqual(resolveAllowedTables(KNOWN_TABLES), [
        "inventory_item",
        "auth_user",
      ]);
    },
  );
});

function guardContext(maxRows = 200) {
  return {
    allowedTables: resolveAllowedTables(KNOWN_TABLES),
    knownTables: KNOWN_TABLES,
    maxRows,
  };
}

test("query guard accepts a plain SELECT and appends a LIMIT", () => {
  const verdict = validateSqlAnalystQuery(
    "SELECT id, name FROM inventory_item WHERE is_active = 1;",
    guardContext(),
  );
  assert.equal(verdict.ok, true);
  assert.equal(
    verdict.ok && verdict.query,
    "SELECT id, name FROM inventory_item WHERE is_active = 1 LIMIT 200",
  );
});

test("query guard keeps an existing LIMIT", () => {
  const verdict = validateSqlAnalystQuery(
    "SELECT id FROM inventory_item LIMIT 5",
    guardContext(),
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.ok && verdict.query, "SELECT id FROM inventory_item LIMIT 5");
});

test("query guard allows CTEs over allowed tables", () => {
  const verdict = validateSqlAnalystQuery(
    `WITH recent AS (
       SELECT location_id, COUNT(*) AS n FROM inventory_inspectionitem GROUP BY location_id
     )
     SELECT l.name, recent.n FROM recent JOIN inventory_location l ON l.id = recent.location_id`,
    guardContext(),
  );
  assert.equal(verdict.ok, true);
});

test("query guard allows columns like created_at and updated_at", () => {
  const verdict = validateSqlAnalystQuery(
    "SELECT created_at, updated_at FROM inventory_item ORDER BY created_at DESC",
    guardContext(),
  );
  assert.equal(verdict.ok, true);
});

test("query guard ignores keywords inside string literals", () => {
  const verdict = validateSqlAnalystQuery(
    "SELECT id FROM inventory_location WHERE name = 'drop off point'",
    guardContext(),
  );
  assert.equal(verdict.ok, true);
});

test("query guard rejects write statements", () => {
  for (const statement of [
    "INSERT INTO inventory_item (name) VALUES ('x')",
    "UPDATE inventory_item SET name = 'x'",
    "DELETE FROM inventory_item",
    "DROP TABLE inventory_item",
    "PRAGMA table_info(auth_user)",
  ]) {
    const verdict = validateSqlAnalystQuery(statement, guardContext());
    assert.equal(verdict.ok, false, `expected rejection: ${statement}`);
  }
});

test("query guard rejects multiple statements", () => {
  const verdict = validateSqlAnalystQuery(
    "SELECT 1; SELECT id FROM auth_user",
    guardContext(),
  );
  assert.equal(verdict.ok, false);
});

test("query guard rejects non-allowlisted tables, including in subqueries", () => {
  for (const statement of [
    "SELECT * FROM auth_user",
    "SELECT * FROM django_session",
    "SELECT (SELECT username FROM auth_user LIMIT 1) AS u FROM inventory_item",
    "SELECT * FROM inventory_item JOIN auth_user ON 1=1",
  ]) {
    const verdict = validateSqlAnalystQuery(statement, guardContext());
    assert.equal(verdict.ok, false, `expected rejection: ${statement}`);
  }
});

test("query guard allows safe table-valued functions in FROM/JOIN", () => {
  for (const statement of [
    "SELECT d.day FROM generate_series(1, 30) AS d(day)",
    `SELECT g.day, COUNT(i.id)
     FROM generate_series('2026-01-01'::date, '2026-01-31'::date, '1 day') AS g(day)
     LEFT JOIN inventory_inspectionitem i ON DATE(i.created_at) = g.day
     GROUP BY g.day`,
    "SELECT t.value FROM inventory_item i CROSS JOIN LATERAL unnest(string_to_array(i.name, ' ')) AS t(value)",
    "SELECT je.key FROM inventory_item i, json_each(i.specifications) je",
  ]) {
    const verdict = validateSqlAnalystQuery(statement, guardContext());
    assert.equal(verdict.ok, true, `expected acceptance: ${statement}`);
  }
});

test("query guard rejects unknown functions used as row sources", () => {
  const verdict = validateSqlAnalystQuery(
    "SELECT * FROM some_mystery_function(1)",
    guardContext(),
  );
  assert.equal(verdict.ok, false);
});

test("query guard rejects dangerous functions anywhere in the statement", () => {
  for (const statement of [
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT id, pg_sleep(60) FROM inventory_item",
    "SELECT * FROM dblink('host=evil', 'select 1') AS t(x int)",
    "SELECT pg_terminate_backend(1234)",
    "SELECT set_config('default_transaction_read_only', 'off', false)",
  ]) {
    const verdict = validateSqlAnalystQuery(statement, guardContext());
    assert.equal(verdict.ok, false, `expected rejection: ${statement}`);
  }
});

test("query guard rejects sensitive columns even on allowed tables", () => {
  withEnv({ AMS_SQL_ALLOWED_TABLES: "auth_user" }, () => {
    const verdict = validateSqlAnalystQuery("SELECT password FROM auth_user", {
      allowedTables: resolveAllowedTables(KNOWN_TABLES),
      knownTables: KNOWN_TABLES,
    });
    assert.equal(verdict.ok, false);
  });
});
