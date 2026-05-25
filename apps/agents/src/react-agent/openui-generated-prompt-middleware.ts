import { createMiddleware, SystemMessage } from "langchain";

import { AMS_OPENUI_SYSTEM_PROMPT } from "./ams-openui.js";

export const openUiGeneratedPromptMiddleware = createMiddleware({
  name: "OpenUiGeneratedPromptMiddleware",
  wrapModelCall: async (request, handler) =>
    handler({
      ...request,
      systemMessage: request.systemMessage.concat(
        new SystemMessage({ content: AMS_OPENUI_SYSTEM_PROMPT }),
      ),
    }),
});
