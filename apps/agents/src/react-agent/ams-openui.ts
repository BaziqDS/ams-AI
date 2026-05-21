import {
  openuiLibrary,
  openuiPromptOptions,
} from "@openuidev/react-ui";
import type { ToolSpec } from "@openuidev/react-lang";

// Central OpenUI contract for the AMS agent. Use OpenUI's standard component
// library so the generated prompt and frontend Renderer stay aligned.
export const amsOpenUiLibrary = openuiLibrary;
export const amsOpenUiToolSpecs: ToolSpec[] = [
  {
    name: "get_page_context",
    description:
      "Read the current AMS page context from the host app, including route, visible rows, active form schema, permissions, and registered frontend actions when available. Use Query() only when the rendered UI itself needs to stay live after the assistant response.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        readables: { type: "array" },
        actions: { type: "array" },
      },
      required: ["readables", "actions"],
      additionalProperties: true,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
];

export const amsOpenUiPromptOptions = {
  ...openuiPromptOptions,
  // Keep AMS live page context available to the browser Renderer, but do not
  // expose it in the agent prompt as an LLM-callable tool. The agent has page
  // context through LangGraph runtime.configurable; exposing this OpenUI-only
  // helper in the prompt made the model call get_page_context as a normal tool.
  tools: openuiPromptOptions.tools ?? [],
  toolCalls: openuiPromptOptions.toolCalls,
  bindings: true,
};
