"use client";

import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent } from "@openuidev/react-lang";
import {
  defaultLightTheme,
  ThemeProvider,
} from "@openuidev/react-ui";
import { amsOpenUiLibrary } from "@/lib/ams-openui";
import { copilotBridge } from "@/lib/copilot-bridge";
import { cn } from "@/lib/utils";

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

export function isSimpleOpenUiTextContent(code: string) {
  const lines = stripOpenUiFence(code)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.length === 1 &&
    /^root\s*=\s*TextContent\s*\(/.test(lines[0])
  );
}

export function extractSimpleOpenUiTextContent(code: string) {
  const lines = stripOpenUiFence(code)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) return null;

  const completeMatch = lines[0].match(
    /^root\s*=\s*TextContent\s*\(\s*"((?:\\.|[^"\\])*)"/,
  );
  const partialMatch = lines[0].match(
    /^root\s*=\s*TextContent\s*\(\s*"((?:\\.|[^"\\])*)$/,
  );
  const value = completeMatch?.[1] ?? partialMatch?.[1];
  if (value === undefined) return null;

  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
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

const openUiToolProvider = {
  get_page_context: async () => copilotBridge.getFreshContext(),
};

export function OpenUiAssistantMessage({
  code,
  fallback,
  isStreaming,
  onAction,
  onPreviewActionChange,
  compactText = false,
}: {
  code: string;
  fallback: ReactNode;
  isStreaming: boolean;
  onAction?: (event: ActionEvent) => void;
  onPreviewActionChange?: (action: (() => void) | null) => void;
  compactText?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [parentPreviewOpen, setParentPreviewOpen] = useState(false);
  const previewId = useId();

  const openPreview = useCallback(() => {
    if (window.parent && window.parent !== window) {
      setParentPreviewOpen(true);
      window.parent.postMessage(
        {
          source: "ams-copilot-iframe",
          type: "OPEN_OPENUI_PREVIEW",
          previewId,
          code,
          isStreaming,
        },
        "*",
      );
      return;
    }
    setIsExpanded(true);
  }, [code, isStreaming, previewId]);

  useEffect(() => {
    onPreviewActionChange?.(openPreview);
    return () => onPreviewActionChange?.(null);
  }, [onPreviewActionChange, openPreview]);

  useEffect(() => {
    if (!isExpanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  useEffect(() => {
    if (!parentPreviewOpen || !window.parent || window.parent === window) return;

    window.parent.postMessage(
      {
        source: "ams-copilot-iframe",
        type: "UPDATE_OPENUI_PREVIEW",
        previewId,
        code,
        isStreaming,
      },
      "*",
    );
  }, [code, isStreaming, parentPreviewOpen, previewId]);

  return (
    <OpenUiErrorBoundary fallback={fallback}>
      <div
        className={cn(
          "openui-chat-frame",
          compactText && "openui-chat-frame--text",
        )}
      >
        <div className="openui-chat-message">
          <ThemeProvider mode="light" lightTheme={defaultLightTheme}>
            <Renderer
              library={amsOpenUiLibrary}
              response={code}
              isStreaming={isStreaming}
              onAction={onAction}
              toolProvider={openUiToolProvider}
            />
          </ThemeProvider>
        </div>
        {isExpanded ? createPortal(
          <div className="openui-chat-modal-backdrop" onClick={() => setIsExpanded(false)}>
            <section
              className="openui-chat-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Generated UI larger view"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="openui-chat-modal-header">
                <div className="openui-chat-modal-preview-label">
                  <span>Generated UI</span>
                  {isStreaming ? (
                    <span className="openui-chat-modal-live" aria-label="Generating preview">
                      <span aria-hidden="true" />
                      Building
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="openui-chat-modal-close"
                  onClick={() => setIsExpanded(false)}
                  aria-label="Close larger generated UI view"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="openui-chat-modal-body openui-chat-message">
                <ThemeProvider mode="light" lightTheme={defaultLightTheme}>
                  <Renderer
                    library={amsOpenUiLibrary}
                    response={code}
                    isStreaming={isStreaming}
                    onAction={onAction}
                    toolProvider={openUiToolProvider}
                  />
                </ThemeProvider>
              </div>
            </section>
          </div>,
          document.body,
        ) : null}
      </div>
    </OpenUiErrorBoundary>
  );
}
