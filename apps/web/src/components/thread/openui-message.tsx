"use client";

import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent } from "@openuidev/react-lang";
import {
  defaultLightTheme,
  ThemeProvider,
} from "@openuidev/react-ui";
import { amsOpenUiLibrary } from "@/lib/ams-openui";
import { copilotBridge } from "@/lib/copilot-bridge";

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

const openUiToolProvider = {
  get_page_context: async () => copilotBridge.getFreshContext(),
};

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
  const [isExpanded, setIsExpanded] = useState(false);

  const openPreview = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { source: "ams-copilot-iframe", type: "OPEN_OPENUI_PREVIEW", code },
        "*",
      );
      return;
    }
    setIsExpanded(true);
  };

  useEffect(() => {
    if (!isExpanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  return (
    <OpenUiErrorBoundary fallback={fallback}>
      <div className="openui-chat-frame">
        <div className="openui-chat-toolbar">
          <button
            type="button"
            className="openui-chat-expand"
            onClick={openPreview}
            aria-label="Open generated UI in larger view"
            title="Open larger preview"
          >
            <span className="openui-chat-toolbar-label">Preview</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h6v6" />
              <path d="M21 3l-7 7" />
              <path d="M9 21H3v-6" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
        </div>
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
                  <span className="openui-chat-toolbar-label">Preview</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6" />
                    <path d="M21 3l-7 7" />
                    <path d="M9 21H3v-6" />
                    <path d="M3 21l7-7" />
                  </svg>
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
