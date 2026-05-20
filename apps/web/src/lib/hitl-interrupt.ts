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

type HitlPageContext = {
  readables?: Array<{ id?: string; description?: string; value?: unknown }>;
  actions?: unknown[];
};

export type HitlReviewModel = {
  title: string;
  description: string;
  intentLabel: string;
  recordLabel: string;
  formId?: string;
  riskLevel: "Low" | "Medium" | "High";
  affectedModules: string[];
  changePreview: string[];
  editableFields: HitlEditableField[];
  auditNote: string;
  approveLabel: string;
  rejectLabel: string;
};

export type HitlEditableField = {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "date" | "select";
  required: boolean;
  missing: boolean;
  value: string | number | boolean | null;
  displayValue: string;
  options?: Array<{ label: string; value: string | number | boolean }>;
};

type LatestAssistantFields = {
  fields: string[];
  currentValues?: unknown;
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

function humanizeToken(value: unknown): string {
  return renderArg(value)
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function readApprovalContext(
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const candidate = args.approvalContext ?? args.reviewContext ?? args.summary;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNestedValue(source: unknown, path: string): unknown {
  if (!path) return undefined;
  if (isObject(source) && path in source) return source[path];
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (isObject(current)) return current[segment];
    return undefined;
  }, source);
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split(".");
  let current: Record<string, unknown> = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const existing = current[segment];
    if (!isObject(existing) && !Array.isArray(existing)) {
      current[segment] = /^\d+$/.test(nextSegment) ? [] : {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]] = value;
}

function findActiveForm(
  pageContext: HitlPageContext | undefined,
  formId: unknown,
): Record<string, unknown> | null {
  const readables = Array.isArray(pageContext?.readables) ? pageContext.readables : [];
  const forms = readables
    .map((readable) => readable.value)
    .filter(isObject)
    .map((value) => (isObject(value.activeForm) ? value.activeForm : null))
    .filter((value): value is Record<string, unknown> => Boolean(value));

  const target = typeof formId === "string" ? formId : null;
  return forms.find((form) => !target || form.formId === target) ?? forms[0] ?? null;
}

function findDetailRecord(pageContext: HitlPageContext | undefined): Record<string, unknown> | null {
  const readables = Array.isArray(pageContext?.readables) ? pageContext.readables : [];
  for (const readable of readables) {
    if (!isObject(readable.value)) continue;
    if (readable.value.page_kind !== "detail") continue;
    return isObject(readable.value.selected_record)
      ? readable.value.selected_record
      : null;
  }
  return null;
}

function findLatestAssistantSetFields(
  pageContext: HitlPageContext | undefined,
  formId: unknown,
): LatestAssistantFields {
  const readables = Array.isArray(pageContext?.readables) ? pageContext.readables : [];
  const activity = readables.find((readable) => readable.id === "__ams_activity_context");
  const value = isObject(activity?.value) ? activity.value : null;
  const events = Array.isArray(value?.recentActivity) ? value.recentActivity : [];
  const target = typeof formId === "string" ? formId : null;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isObject(event)) continue;
    if (event.kind !== "form_values_set" || event.actor !== "assistant") continue;
    if (target && event.formId !== target) continue;
    if (!Array.isArray(event.fields)) continue;
    return {
      fields: event.fields.filter((field): field is string => typeof field === "string"),
      currentValues: event.currentValues,
    };
  }

  return { fields: [] };
}

function fieldMap(activeForm: Record<string, unknown> | null) {
  const fields = Array.isArray(activeForm?.fields) ? activeForm.fields : [];
  return new Map(
    fields
      .filter(isObject)
      .filter((field): field is Record<string, unknown> & { name: string } => typeof field.name === "string")
      .map((field) => [field.name, field]),
  );
}

function expandedFieldNames(
  fields: string[],
  activeForm: Record<string, unknown> | null,
  currentValues?: unknown,
): string[] {
  const fieldsByName = fieldMap(activeForm);
  const allNames = Array.from(fieldsByName.keys());
  const expanded: string[] = [];

  for (const name of fields) {
    const directValue = getNestedValue(currentValues, name);
    const directField = fieldsByName.get(name);
    if (fieldsByName.has(name) && directField?.type !== "array" && !Array.isArray(directValue)) {
      expanded.push(name);
      continue;
    }

    const prefix = `${name}.`;
    const childNames = allNames.filter((fieldName) => fieldName.startsWith(prefix));
    if (childNames.length) {
      expanded.push(...childNames);
      continue;
    }

    if (Array.isArray(directValue)) {
      const generatedChildNames = directValue.flatMap((row, index) => {
        if (!isObject(row)) return [];
        return Object.keys(row)
          .filter((key) => !["id", "index"].includes(key))
          .filter((key) => {
            const entry = row[key];
            return entry === null || ["string", "number", "boolean"].includes(typeof entry);
          })
          .map((key) => `${name}.${index}.${key}`);
      });
      expanded.push(...(generatedChildNames.length ? generatedChildNames : [name]));
      continue;
    }

    expanded.push(name);
  }

  return Array.from(new Set(expanded));
}

function normalizedOptions(field: Record<string, unknown> | undefined) {
  if (!Array.isArray(field?.options)) return undefined;
  const options = field.options
    .filter(isObject)
    .map((option) => {
      const value = option.value;
      if (
        typeof option.label !== "string" ||
        !["string", "number", "boolean"].includes(typeof value)
      ) {
        return null;
      }
      return {
        label: option.label,
        value: value as string | number | boolean,
      };
    })
    .filter((option): option is { label: string; value: string | number | boolean } =>
      Boolean(option),
    );
  return options.length ? options : undefined;
}

function isEmptyFieldValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

function formatDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function renderFieldValue(field: Record<string, unknown> | undefined, value: unknown) {
  if (value === undefined || value === null) return "Not set";
  const option = Array.isArray(field?.options)
    ? field.options.find((entry) => {
        if (!isObject(entry)) return false;
        return String(entry.value) === String(value);
      })
    : null;
  if (isObject(option) && typeof option.label === "string") {
    return `${option.label} (${renderArg(value)})`;
  }
  if (field?.type === "date" && typeof value === "string") return formatDateValue(value);
  return renderArg(value);
}

function normalizeFieldType(field: Record<string, unknown> | undefined): HitlEditableField["type"] {
  const type = field?.type;
  if (type === "number" || type === "boolean" || type === "date" || type === "select") {
    return type;
  }
  return "string";
}

function normalizeFieldValue(value: unknown): HitlEditableField["value"] {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function liveEditableFields(
  activeForm: Record<string, unknown> | null,
  fields: string[],
  currentValues?: unknown,
): HitlEditableField[] {
  if (!activeForm || fields.length === 0) return [];
  const fieldsByName = fieldMap(activeForm);
  const fallbackValues = [
    currentValues ? expandBulkValues(currentValues, fields, fieldsByName) : undefined,
    currentValues,
    isObject(activeForm.lastAssistantEdit) ? activeForm.lastAssistantEdit.currentValues : undefined,
    activeForm.values,
  ];
  const changedFieldNames = expandedFieldNames(fields, activeForm, currentValues);
  const missingRequiredNames = Array.from(fieldsByName.values())
    .filter((field) => field.required === true && field.readOnly !== true)
    .map((field) => field.name)
    .filter((name) => {
      if (changedFieldNames.includes(name)) return false;
      const value = fallbackValues.reduce<unknown>((resolved, source) => {
        if (resolved !== undefined) return resolved;
        return getNestedValue(source, name);
      }, undefined);
      return isEmptyFieldValue(value);
    });

  return [...changedFieldNames, ...missingRequiredNames].map((name) => {
    const field = fieldsByName.get(name);
    const label = typeof field?.label === "string" ? field.label : humanizeToken(name);
    const value = fallbackValues.reduce<unknown>((resolved, source) => {
      if (resolved !== undefined) return resolved;
      return getNestedValue(source, name);
    }, undefined);
    const normalizedValue = normalizeFieldValue(value);
    const required = field?.required === true;
    const missing = required && isEmptyFieldValue(normalizedValue);
    return {
      name,
      label,
      type: normalizeFieldType(field),
      required,
      missing,
      value: normalizedValue,
      displayValue: renderFieldValue(field, normalizedValue),
      options: normalizedOptions(field),
    };
  });
}

function expandBulkValues(
  values: unknown,
  fields: string[],
  fieldsByName: Map<string, Record<string, unknown> & { name: string }>,
) {
  if (!isObject(values)) return undefined;
  const expanded: Record<string, unknown> = { ...values };
  const knownNames = Array.from(fieldsByName.keys());

  for (const field of fields) {
    const value = getNestedValue(values, field);
    if (!Array.isArray(value)) continue;

    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!isObject(item)) continue;
      const prefix = `${field}.${index}.`;
      for (const knownName of knownNames) {
        if (!knownName.startsWith(prefix)) continue;
        const childKey = knownName.slice(prefix.length);
        const childValue = getNestedValue(item, childKey);
        if (childValue !== undefined) setNestedValue(expanded, knownName, childValue);
      }
    }
  }

  return expanded;
}

function inferModule(formOrAction: string): {
  noun: string;
  modules: string[];
} {
  const normalized = formOrAction.toLowerCase();
  if (normalized.includes("inspection")) {
    return {
      noun: "inspection certificate",
      modules: ["Inspections", "Stock Register", "Finance Review"],
    };
  }
  if (normalized.includes("category")) {
    return { noun: "category", modules: ["Categories"] };
  }
  if (normalized.includes("item")) {
    return { noun: "item", modules: ["Items", "Stock Register"] };
  }
  if (normalized.includes("stock")) {
    return { noun: "stock entry", modules: ["Stock Entries", "Stock Register"] };
  }
  if (normalized.includes("maintenance")) {
    return { noun: "maintenance record", modules: ["Maintenance", "Items"] };
  }
  if (normalized.includes("depreciation") || normalized.includes("finance")) {
    return { noun: "finance record", modules: ["Depreciation", "Finance Review"] };
  }
  if (normalized.includes("location")) {
    return { noun: "location", modules: ["Locations"] };
  }
  return { noun: "AMS record", modules: ["AMS"] };
}

function intentVerb(intent: unknown): string {
  const normalized = String(intent ?? "save").toLowerCase();
  if (["submit", "approve", "advance", "initiate"].includes(normalized)) {
    return "Submit";
  }
  if (normalized === "delete") return "Delete";
  if (normalized === "reject") return "Reject";
  return "Save";
}

function riskForIntent(intent: string): HitlReviewModel["riskLevel"] {
  if (["Submit", "Delete", "Reject"].includes(intent)) return "High";
  return "Medium";
}

function defaultChangePreview(action: HitlActionRequest): string[] {
  const hiddenKeys = new Set(["approvalContext", "reviewContext", "summary"]);
  const entries = Object.entries(action.args)
    .filter(([key]) => !hiddenKeys.has(key))
    .map(([key, value]) => `${humanizeToken(key)}: ${renderArg(value)}`)
    .slice(0, 6);

  if (entries.length) return entries;
  return ["The assistant will run the requested AMS action after approval."];
}

export function buildHitlReviewModel(
  action: HitlActionRequest,
  pageContext?: HitlPageContext,
): HitlReviewModel {
  const context = readApprovalContext(action.args);
  const activeForm = findActiveForm(pageContext, action.args.formId ?? action.args.form_id);
  const detailRecord = findDetailRecord(pageContext);
  const liveChangedFields = findLatestAssistantSetFields(
    pageContext,
    action.args.formId ?? action.args.form_id,
  );
  const editableFields = liveEditableFields(
    activeForm,
    liveChangedFields.fields,
    liveChangedFields.currentValues,
  );
  const target = renderArg(
    context?.recordLabel ??
      context?.record ??
      detailRecord?.contract_no ??
      detailRecord?.name ??
      detailRecord?.code ??
      action.args.formId ??
      action.args.form_id ??
      action.args.path ??
      action.name,
  );
  const { noun, modules } = inferModule(`${target} ${action.name}`);
  const intent = intentVerb(context?.intent ?? action.args.intent);
  const liveChanges = editableFields.map((field) => `${field.label}: ${field.displayValue}`);
  const changePreview =
    liveChanges.length > 0
      ? liveChanges
      :
    readStringArray(context?.changes) ??
    readStringArray(context?.changePreview) ??
    defaultChangePreview(action);
  const affectedModules =
    readStringArray(context?.affectedModules) ??
    readStringArray(context?.modules) ??
    modules;
  const riskValue = context?.riskLevel;
  const riskLevel =
    riskValue === "Low" || riskValue === "Medium" || riskValue === "High"
      ? riskValue
      : riskForIntent(intent);

  return {
    title:
      typeof context?.title === "string" && context.title.trim()
        ? context.title.trim()
        : `${intent} ${noun}`,
    description:
      liveChanges.length > 0
        ? `Review the exact fields the assistant filled before approving this ${intent.toLowerCase()}.`
        :
      typeof context?.description === "string" && context.description.trim()
        ? context.description.trim()
        : action.description ??
          `The assistant is requesting permission to ${intent.toLowerCase()} this ${noun}.`,
    intentLabel: intent,
    recordLabel: target,
    formId:
      typeof action.args.formId === "string"
        ? action.args.formId
        : typeof action.args.form_id === "string"
          ? action.args.form_id
          : undefined,
    riskLevel,
    affectedModules,
    changePreview,
    editableFields,
    auditNote:
      typeof context?.auditNote === "string" && context.auditNote.trim()
        ? context.auditNote.trim()
        : "No database write will run until you approve.",
    approveLabel:
      typeof context?.approveLabel === "string" && context.approveLabel.trim()
        ? context.approveLabel.trim()
        : intent === "Save"
          ? "Approve save"
          : "Approve submit",
    rejectLabel:
      typeof context?.rejectLabel === "string" && context.rejectLabel.trim()
        ? context.rejectLabel.trim()
        : "Send back",
  };
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
