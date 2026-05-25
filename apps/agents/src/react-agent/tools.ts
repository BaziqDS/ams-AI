import { tool } from "langchain";
import { z } from "zod";

import { FRONTEND_TOOLS } from "./frontend-tools.js";

const getCurrentTime = tool(async () => new Date().toISOString(), {
  name: "get_current_time",
  description: "Return the current server time as an ISO timestamp.",
  schema: z.object({}),
});

export const ORCHESTRATOR_TOOLS = [getCurrentTime];
export const FRONTEND_CONTROLLER_TOOLS = [...FRONTEND_TOOLS];

// Backward-compatible export for tests/imports that still refer to the legacy
// single-agent registry.
export const TOOLS = [...ORCHESTRATOR_TOOLS, ...FRONTEND_CONTROLLER_TOOLS];
