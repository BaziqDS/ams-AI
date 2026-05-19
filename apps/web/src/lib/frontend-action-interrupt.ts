export type FrontendActionRequest = {
  name: string;
  args?: unknown;
};

export type FrontendActionInterrupt = {
  type: "frontend_action_request";
  action: FrontendActionRequest;
};

export type FrontendActionResume =
  | {
      ok: true;
      action: FrontendActionRequest;
      result: unknown;
    }
  | {
      ok: false;
      action: FrontendActionRequest;
      error: string;
    };

export function isFrontendActionInterruptSchema(
  value: unknown,
): value is FrontendActionInterrupt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FrontendActionInterrupt>;
  return (
    candidate.type === "frontend_action_request" &&
    Boolean(candidate.action) &&
    typeof candidate.action === "object" &&
    typeof candidate.action.name === "string"
  );
}

export function buildFrontendActionResume(
  request: FrontendActionInterrupt,
  result?: unknown,
  error?: unknown,
): FrontendActionResume {
  if (error !== undefined && error !== null) {
    return {
      ok: false,
      action: request.action,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    action: request.action,
    result: result ?? null,
  };
}
