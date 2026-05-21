import type { PageContext } from "./copilot-bridge";

const DEFAULT_RECURSION_LIMIT = 80;

function readRecursionLimit() {
  const configured = Number(process.env.NEXT_PUBLIC_AGENT_RECURSION_LIMIT);
  return Number.isFinite(configured) && configured >= 25
    ? Math.floor(configured)
    : DEFAULT_RECURSION_LIMIT;
}

export function buildAgentRunConfig(pageContext: PageContext | unknown) {
  return {
    recursion_limit: readRecursionLimit(),
    configurable: {
      pageContext,
    },
  };
}
