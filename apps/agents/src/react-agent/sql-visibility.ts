const SENSITIVE_SQL_TABLE_PATTERNS = [
  /^auth_/i,
  /^django_/i,
  /^silk_/i,
  /^token_blacklist_/i,
];

const SENSITIVE_SQL_TABLE_NAMES = new Set(["django_session"]);

export function isSensitiveSqlTable(tableName: string): boolean {
  const normalized = tableName
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .toLowerCase();
  if (!normalized) return false;
  if (SENSITIVE_SQL_TABLE_NAMES.has(normalized)) return true;
  return SENSITIVE_SQL_TABLE_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

export function filterInspectableSqlTables(tableNames: string[]): {
  visible: string[];
  hidden: string[];
} {
  const visible: string[] = [];
  const hidden: string[] = [];

  for (const tableName of tableNames) {
    const trimmed = tableName.trim();
    if (!trimmed) continue;
    if (isSensitiveSqlTable(trimmed)) {
      hidden.push(trimmed);
    } else {
      visible.push(trimmed);
    }
  }

  return { visible, hidden };
}

export function formatHiddenSqlTablesWarning(hidden: string[]): string {
  if (hidden.length === 0) return "";
  const noun = hidden.length === 1 ? "table is" : "tables are";
  return (
    `${hidden.length} internal or sensitive ${noun} hidden from SQL tools. ` +
    "Use AMS page context, frontend actions, or safe application APIs for user, auth, session, token, and tracing data."
  );
}

export function findSensitiveSqlTableReferences(query: string): string[] {
  const references = new Set<string>();
  const normalizedQuery = query.replace(/["'`]/g, "");
  const tableLikePattern =
    /\b(auth_[a-z0-9_]*|django_[a-z0-9_]*|silk_[a-z0-9_]*|token_blacklist_[a-z0-9_]*)\b/gi;

  for (const match of normalizedQuery.matchAll(tableLikePattern)) {
    const tableName = match[1];
    if (isSensitiveSqlTable(tableName)) {
      references.add(tableName.toLowerCase());
    }
  }

  return [...references];
}
