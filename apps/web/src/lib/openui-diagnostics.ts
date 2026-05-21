import type { OpenUIError, ParseResult } from "@openuidev/react-lang";

type OpenUiDiagnosticError = OpenUIError | ParseResult["meta"]["errors"][number];

export function formatOpenUiErrors(errors: OpenUiDiagnosticError[]) {
  return errors
    .map((error) => {
      const diagnostic = error as OpenUiDiagnosticError & {
        statementId?: string;
        source?: string;
        hint?: string;
        path?: string;
      };
      const statement = diagnostic.statementId
        ? `"${diagnostic.statementId}": `
        : "";
      const source = diagnostic.source ?? "parser";
      const code = diagnostic.code ? `${diagnostic.code}: ` : "";
      const location = diagnostic.path ? ` (${diagnostic.path})` : "";
      const hint = diagnostic.hint ? ` Hint: ${diagnostic.hint}` : "";
      return `[${source}] ${statement}${code}${diagnostic.message}${location}${hint}`;
    })
    .join("\n");
}

export function formatOpenUiParseDiagnostics(result: ParseResult | null) {
  if (!result) return "";

  const { errors, unresolved, orphaned } = result.meta;
  const lines: string[] = [];
  const formattedErrors = formatOpenUiErrors(errors);
  if (formattedErrors) lines.push(formattedErrors);
  if (unresolved.length) {
    lines.push(`Unresolved references: ${unresolved.join(", ")}`);
  }
  if (orphaned.length) {
    lines.push(`Defined but unreachable from root: ${orphaned.join(", ")}`);
  }

  return lines.join("\n");
}

export function buildOpenUiRepairPrompt({
  diagnostics,
  code,
}: {
  diagnostics: string;
  code: string;
}) {
  return [
    "OPENUI_RENDERER_REPAIR_REQUEST",
    "The previous assistant response was invalid OpenUI and did not render correctly.",
    "Rewrite the final answer as valid OpenUI only. Do not call tools unless the user request itself still requires live data.",
    "Keep the same user-facing intent, but fix the OpenUI code using only registered OpenUI components and actions.",
    "Start with root = Stack(...). Ensure every referenced variable is defined and reachable from root.",
    "",
    "Renderer diagnostics:",
    diagnostics,
    "",
    "Invalid OpenUI code:",
    "```openui",
    code,
    "```",
  ].join("\n");
}

export function openUiDiagnosticKey(messageId: string, diagnostics: string) {
  return `${messageId}:${diagnostics.slice(0, 2000)}`;
}
