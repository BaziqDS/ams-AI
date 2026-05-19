"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Renderer } from "@openuidev/react-lang";
import type {
  ActionEvent,
  OpenUIError,
  ParseResult,
} from "@openuidev/react-lang";
import {
  defaultLightTheme,
  ThemeProvider,
} from "@openuidev/react-ui";
import { amsOpenUiLibrary } from "@/lib/ams-openui";

function stripOpenUiFence(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:openui|openui-lang|text)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export function getOpenUiLang(content: string) {
  const code = stripOpenUiFence(content);
  if (/^root\s*=/.test(code)) return code;

  const rootMatch = code.match(/(^|\n)(root\s*=[\s\S]*)/);
  return rootMatch?.[2]?.trim() ?? null;
}

class OpenUiErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("OpenUI render failed", error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function formatOpenUiErrors(errors: OpenUIError[]) {
  return errors
    .map((error) => {
      const statement = error.statementId ? `"${error.statementId}": ` : "";
      const hint = error.hint ? ` Hint: ${error.hint}` : "";
      return `[${error.source}] ${statement}${error.message}${hint}`;
    })
    .join("\n");
}

function reportOpenUiParseResult(result: ParseResult | null) {
  if (!result) return;

  const { errors, unresolved, orphaned } = result.meta;
  if (!errors.length && !unresolved.length && !orphaned.length) return;

  console.warn("OpenUI parse diagnostics", {
    statementCount: result.meta.statementCount,
    unresolved,
    orphaned,
    errors,
  });
}

export function OpenUiAssistantMessage({
  code,
  fallback,
  isStreaming,
  onAction,
}: {
  code: string;
  fallback: ReactNode;
  isStreaming: boolean;
  onAction?: (event: ActionEvent) => void;
}) {
  return (
    <OpenUiErrorBoundary fallback={fallback}>
      <div className="openui-chat-message">
        <ThemeProvider theme={defaultLightTheme}>
          <Renderer
            library={amsOpenUiLibrary}
            response={code}
            isStreaming={isStreaming}
            onAction={onAction}
            onError={(errors) => {
              if (errors.length) {
                console.warn("OpenUI validation errors", formatOpenUiErrors(errors));
              }
            }}
            onParseResult={reportOpenUiParseResult}
          />
        </ThemeProvider>
      </div>
    </OpenUiErrorBoundary>
  );
}
