import {
  openuiLibrary,
  openuiPromptOptions,
} from "@openuidev/react-ui";

// Central OpenUI contract for the AMS agent. Use OpenUI's standard component
// library so the generated prompt and frontend Renderer stay aligned.
export const amsOpenUiLibrary = openuiLibrary;
// Follow the OpenUI docs verbatim:
//   const systemPrompt = openuiLibrary.prompt(openuiPromptOptions)
// Do not widen the generated syntax surface here; AMS-specific guidance lives
// in prompts.ts before the generated OpenUI system prompt.
export const amsOpenUiPromptOptions = openuiPromptOptions;
export const AMS_OPENUI_SYSTEM_PROMPT = amsOpenUiLibrary.prompt({
  ...amsOpenUiPromptOptions,
});
