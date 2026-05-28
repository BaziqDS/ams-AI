import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpIcon,
  Bot,
  CalendarDays,
  Check,
  ClipboardList,
  FileText,
  MessageSquare,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStreamContext } from "@/providers/Stream";
import { copilotBridge, type PageContext } from "@/lib/copilot-bridge";
import {
  buildHitlResume,
  buildHitlReviewModel,
  type HitlRequest,
} from "@/lib/hitl-interrupt";
import { buildAgentRunConfig } from "@/lib/agent-run-config";

type ReviewTab = "summary" | "fields";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function humanizeToken(value: unknown): string {
  return String(value ?? "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDisplayDate(value: Date) {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${value.getFullYear()}`;
}

function findActiveForm(pageContext: PageContext | null, formId: unknown) {
  const forms = (pageContext?.readables ?? [])
    .map((readable) => readable.value)
    .filter(isRecord)
    .map((value) => (isRecord(value.activeForm) ? value.activeForm : null))
    .filter((value): value is Record<string, unknown> => Boolean(value));
  const target = typeof formId === "string" ? formId : null;
  return forms.find((form) => !target || form.formId === target) ?? forms[0] ?? null;
}

function runtimeUser(pageContext: PageContext | null) {
  const runtime = pageContext?.readables.find(
    (readable) => readable.id === "__ams_runtime_context",
  );
  const user =
    isRecord(runtime?.value) && isRecord(runtime.value.user)
      ? runtime.value.user
      : null;
  const fullName =
    user &&
    [
      typeof user.first_name === "string" ? user.first_name : "",
      typeof user.last_name === "string" ? user.last_name : "",
    ]
      .join(" ")
      .trim();
  return (
    fullName ||
    (typeof user?.username === "string" ? user.username : "") ||
    (typeof user?.email === "string" ? user.email : "") ||
    "Current user"
  );
}

function detailsFromPreview(preview: string[]) {
  return preview.map((line) => {
    const [label, ...rest] = line.split(": ");
    return {
      name: label || "Field",
      label: label || "Field",
      value: rest.length ? rest.join(": ") : line,
      missing: /not set/i.test(line),
    };
  });
}

type FieldRow = {
  name: string;
  label: string;
  value: string;
  missing: boolean;
};

type FieldGroup = {
  /** Heading text — e.g. "Top-level", "Items · row 1" */
  title: string;
  /** Optional secondary label like "items.0" */
  subtitle?: string;
  rows: FieldRow[];
};

/**
 * Bucket flat dotted-path fields into logical groups:
 *   - Top-level fields → "Form fields"
 *   - items.0.foo → "Items · row 1"
 *   - items.1.bar → "Items · row 2"
 *   - similar for other array fields
 */
function groupFields(rows: FieldRow[]): FieldGroup[] {
  // Match dotted paths like "items.0.item_name" → [arrayName, index, rest].
  const ROW_RE = /^([A-Za-z_][A-Za-z0-9_]*)\.(\d+)\.(.+)$/;
  const topLevel: FieldRow[] = [];
  // Map<arrayName, Map<index, FieldRow[]>>
  const arrays = new Map<string, Map<number, FieldRow[]>>();

  for (const row of rows) {
    const match = ROW_RE.exec(row.name);
    if (!match) {
      topLevel.push(row);
      continue;
    }
    const arrayName = match[1];
    const index = Number(match[2]);
    const rest = match[3];
    const childLabel = humanizeToken(rest.split(".").pop() || rest);
    const childRow: FieldRow = {
      ...row,
      label: childLabel,
    };
    if (!arrays.has(arrayName)) arrays.set(arrayName, new Map());
    const rowMap = arrays.get(arrayName)!;
    if (!rowMap.has(index)) rowMap.set(index, []);
    rowMap.get(index)!.push(childRow);
  }

  const groups: FieldGroup[] = [];
  if (topLevel.length > 0) {
    groups.push({ title: "Form fields", rows: topLevel });
  }
  for (const [arrayName, rowMap] of arrays.entries()) {
    const arrayLabel = humanizeToken(arrayName);
    const sortedIndexes = [...rowMap.keys()].sort((a, b) => a - b);
    for (const idx of sortedIndexes) {
      groups.push({
        title: `${arrayLabel} · row ${idx + 1}`,
        subtitle: `${arrayName}.${idx}`,
        rows: rowMap.get(idx)!,
      });
    }
  }
  return groups;
}

export function HitlInterruptView({ interrupt }: { interrupt: HitlRequest }) {
  const thread = useStreamContext();
  const [busy, setBusy] = useState<"approve" | "reject" | "fix" | null>(null);
  const [tab, setTab] = useState<ReviewTab>("summary");
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [requestedAt] = useState(() => new Date());
  const [feedback, setFeedback] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the textarea to fit its content — no inner scrollbar, no
  // arbitrary height cap. The textarea pushes the action buttons down as
  // the user types.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [feedback]);

  useEffect(() => {
    let alive = true;
    copilotBridge
      .getFreshContext({ timeoutMs: 5000, requireFresh: true })
      .then((context) => {
        if (alive) setPageContext(context);
      })
      .catch(() => {
        if (alive) setPageContext(null);
      });
    return () => {
      alive = false;
    };
  }, [interrupt]);

  const resume = async (
    decision: "approve" | "reject" | "fix",
    feedbackMessage?: string,
  ) => {
    if (busy || thread.isLoading) return;
    setBusy(decision);
    const freshContext = await copilotBridge.getFreshContext({
      timeoutMs: 5000,
      requireFresh: true,
    });

    try {
      thread.submit(
        {},
        {
          command: {
            resume: buildHitlResume(
              interrupt,
              decision,
              decision === "fix" ? feedbackMessage : undefined,
            ),
          },
          config: buildAgentRunConfig(freshContext),
          streamMode: ["values", "custom"],
        },
      );
    } finally {
      setBusy(null);
    }
  };

  const action = interrupt.actionRequests[0];
  const model = buildHitlReviewModel(action, pageContext ?? undefined);
  const activeForm = findActiveForm(pageContext, action.args.formId ?? action.args.form_id);
  const formLabel =
    (typeof activeForm?.title === "string" && activeForm.title.trim()) ||
    model.formId ||
    humanizeToken(action.name);
  const metadata = [
    { label: "Form", value: formLabel, icon: FileText },
    { label: "Requested by", value: runtimeUser(pageContext), icon: UserRound },
    { label: "Filled by", value: "AMS Assistant", icon: Bot },
    { label: "Date", value: formatDisplayDate(requestedAt), icon: CalendarDays },
    { label: "Status", value: "Ready", icon: ClipboardList },
  ];

  // Prefer the FULL current form snapshot — every non-readonly field with its
  // current value — so the user reviews the whole form, not just the agent's
  // most recent edits. Falls back to the agent's edits, then to the static
  // changePreview, when the snapshot is unavailable (e.g., off-form HITL).
  const snapshotSource =
    model.currentFormValues.length > 0
      ? model.currentFormValues
      : model.editableFields;

  const detailRows: FieldRow[] = snapshotSource.length
    ? snapshotSource.map((field) => ({
        name: field.name,
        label: field.label,
        value: field.displayValue,
        missing: field.missing,
      }))
    : detailsFromPreview(model.changePreview);

  const groupedFields = useMemo(() => groupFields(detailRows), [detailRows]);
  const totalFields = detailRows.length;
  const missingCount = detailRows.filter((row) => row.missing).length;

  return (
    <div className="box-border w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-amber-100/60 to-amber-200/40 text-slate-950 shadow-sm ring-1 ring-amber-100/60">
      {/* Header */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5 border-b border-amber-200/70 bg-white/60 px-2.5 py-1.5 sm:px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100/80 text-amber-700">
            <ShieldCheck className="size-3.5" />
          </span>
          <div className="min-w-0">
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50/70 px-1 py-0 text-[9px] uppercase tracking-[0.12em] text-amber-700"
            >
              Approval required
            </Badge>
            <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-950">
              {model.title}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1" role="tablist" aria-label="Approval sections">
          {(["summary", "fields"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              className={
                "h-6 inline-flex items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition " +
                (tab === item
                  ? "border-amber-300 bg-amber-100/70 text-amber-900"
                  : "border-transparent bg-transparent text-amber-700/70 hover:bg-amber-100/50 hover:text-amber-900")
              }
              onClick={() => setTab(item)}
            >
              {item === "summary" ? (
                "Summary"
              ) : (
                <>
                  Fields
                  {totalFields ? (
                    <Badge
                      variant="secondary"
                      className="h-3.5 min-w-3.5 border-amber-300/60 bg-amber-200/60 px-1 text-[9.5px] font-semibold text-amber-900"
                    >
                      {totalFields}
                    </Badge>
                  ) : null}
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="px-2.5 pb-2 pt-2 sm:px-3">
        {model.description ? (
          <p className="mb-2 max-w-3xl text-[11.5px] leading-[1.4] text-slate-600">
            {model.description}
          </p>
        ) : null}

        {tab === "summary" ? (
          <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-0.5 md:grid-cols-2">
            {metadata.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="grid min-h-7 min-w-0 grid-cols-[16px_minmax(80px,0.45fr)_minmax(0,1fr)] items-center gap-1.5 border-b border-slate-100 text-[12px] last:border-b-0"
              >
                <Icon className="size-3.5 text-amber-600" />
                <span className="font-medium text-slate-500">{label}</span>
                <span className="truncate font-medium text-slate-950" title={value}>
                  {value}
                </span>
              </div>
            ))}
            {totalFields > 0 ? (
              <div className="col-span-full mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="secondary"
                  className="border-amber-300/60 bg-amber-200/60 px-1.5 py-0 text-[10px] text-amber-900"
                >
                  {totalFields} field{totalFields === 1 ? "" : "s"} to apply
                </Badge>
                {missingCount > 0 ? (
                  <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                    {missingCount} still missing
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "fields" ? (
          <div className="max-h-60 min-w-0 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-amber-200/80 [&::-webkit-scrollbar-track]:bg-transparent">
            {groupedFields.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-2.5 py-3 text-center text-[11px] text-slate-500">
                No field changes captured — the agent will rely on the values already in the form.
              </div>
            ) : (
              groupedFields.map((group, groupIdx) => (
                <section
                  key={`${group.title}-${groupIdx}`}
                  className="mb-2 overflow-hidden rounded-lg border border-amber-100/80 bg-white last:mb-0"
                >
                  <header className="flex items-baseline justify-between border-b border-amber-100/70 bg-amber-50/40 px-2 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700">
                      {group.title}
                    </span>
                    {group.subtitle ? (
                      <span className="font-mono text-[9.5px] text-slate-400">
                        {group.subtitle}
                      </span>
                    ) : null}
                  </header>
                  <div className="grid min-w-0 grid-cols-1">
                    {group.rows.map((row) => (
                      <div
                        key={`${row.name}:${row.value}`}
                        className="grid min-h-7 min-w-0 grid-cols-[minmax(100px,0.38fr)_minmax(0,1fr)] items-center gap-1.5 border-b border-slate-100 px-2 text-[12px] last:border-b-0"
                      >
                        <span
                          className="truncate font-medium text-slate-500"
                          title={row.label}
                        >
                          {row.label}
                        </span>
                        <span
                          className={
                            "truncate font-medium " +
                            (row.missing ? "text-red-600" : "text-slate-900")
                          }
                          title={row.missing ? "Not filled" : row.value}
                        >
                          {row.missing ? "Not filled" : row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* Footer: feedback input + action buttons */}
      <div className="border-t border-amber-200/70 bg-white/70 px-2.5 py-1.5 sm:px-3">
        {/* Inline feedback textarea — lets the user redirect the agent without
            leaving the card. Empty → Approve. Non-empty → Send fix. */}
        <div className="mb-1.5 rounded-md border border-slate-200 bg-white focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-200">
          <label className="flex items-start gap-1.5 px-2 py-1">
            <MessageSquare className="mt-0.5 size-3 shrink-0 text-slate-400" />
            <textarea
              ref={textareaRef}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && feedback.trim()) {
                  event.preventDefault();
                  void resume("fix", feedback.trim());
                }
              }}
              placeholder="Tell the agent what to fix — sending will reject this approval and let the agent correct it."
              rows={1}
              className="w-full resize-none overflow-hidden border-0 bg-transparent text-[11.5px] leading-[1.4] text-slate-800 placeholder:text-slate-400 focus:outline-none"
              style={{ minHeight: 18 }}
              disabled={Boolean(busy) || thread.isLoading}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {feedback.trim() ? (
            /* Typing → only the Send icon button. Approve and Reject are
               hidden because typing feedback already implies rejecting the
               current approval. */
            <Button
              variant="outline"
              size="sm"
              aria-label="Send feedback to agent"
              title="Reject this approval and send your message — the agent will correct the form and request approval again."
              onClick={() => resume("fix", feedback.trim())}
              disabled={Boolean(busy) || thread.isLoading}
              className="size-7 p-0"
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resume("reject")}
                disabled={Boolean(busy) || thread.isLoading}
                className="h-7 px-2.5 text-[11.5px]"
              >
                <X className="size-3.5" />
                {busy === "reject" ? "Rejecting…" : "Reject"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resume("approve")}
                disabled={Boolean(busy) || thread.isLoading}
                className="h-7 px-2.5 text-[11.5px]"
              >
                <Check className="size-3.5" />
                {busy === "approve" ? "Approving…" : "Approve"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
