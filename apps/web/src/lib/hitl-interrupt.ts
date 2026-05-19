export type HitlDecision = { type: "approve" } | { type: "reject"; message?: string };

export type HitlActionRequest = {
  name: string;
  args: Record<string, unknown>;
  description?: string;
};

export type HitlReviewConfig = {
  actionName: string;
  allowedDecisions: Array<"approve" | "edit" | "reject">;
};

export type HitlRequest = {
  actionRequests: HitlActionRequest[];
  reviewConfigs: HitlReviewConfig[];
};

export function isHitlInterruptSchema(value: unknown): value is HitlRequest {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as HitlRequest).actionRequests) &&
    Array.isArray((value as HitlRequest).reviewConfigs)
  );
}

export function buildHitlResume(
  request: HitlRequest,
  type: "approve" | "reject",
): { decisions: HitlDecision[] } {
  return {
    decisions: request.actionRequests.map((action) =>
      type === "approve"
        ? { type: "approve" }
        : {
            type: "reject",
            message: `User rejected ${action.name}. Do not submit the form.`,
          },
    ),
  };
}

function renderArg(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function titleForActionName(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getHitlActionReviewCopy(action: HitlActionRequest): {
  title: string;
  description: string;
  details: string[];
} {
  if (action.name === "request_form_submit") {
    const formId = action.args.formId;
    const intent = action.args.intent ?? "save";
    return {
      title: "Submit active AMS form",
      description:
        "Approve only after checking the visible AMS form. This runs against the form currently open in the browser using your signed-in permissions, and may create, update, submit, or advance workflow records.",
      details: [
        ...(formId ? [`Form: ${renderArg(formId)}`] : []),
        `Intent: ${renderArg(intent)}`,
      ],
    };
  }

  return {
    title: titleForActionName(action.name),
    description:
      action.description ??
      "Approve only if this browser action matches what you want the assistant to do in AMS.",
    details: Object.entries(action.args)
      .map(([key, value]) => `${key}: ${renderArg(value)}`)
      .slice(0, 8),
  };
}
