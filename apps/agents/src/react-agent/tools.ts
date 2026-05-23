import { tool } from "langchain";
import { z } from "zod";

import { FRONTEND_TOOLS } from "./frontend-tools.js";

const getCurrentTime = tool(async () => new Date().toISOString(), {
  name: "get_current_time",
  description: "Return the current server time as an ISO timestamp.",
  schema: z.object({}),
});

export const TOOLS = [getCurrentTime, ...FRONTEND_TOOLS];
