import { useEffect, useState } from "react";
import {
  Bot,
  CalendarDays,
  Check,
  ClipboardList,
  FileText,
  UserRound,
  X,
} from "lucide-react";
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
      label: label || "Field",
      value: rest.length ? rest.join(": ") : line,
      missing: /not set/i.test(line),
    };
  });
}

export function HitlInterruptView({ interrupt }: { interrupt: HitlRequest }) {
  const thread = useStreamContext();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [tab, setTab] = useState<ReviewTab>("summary");
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [requestedAt] = useState(() => new Date());

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

  const resume = async (decision: "approve" | "reject") => {
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
            resume: buildHitlResume(interrupt, decision),
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
  const detailRows = model.editableFields.length
    ? model.editableFields.map((field) => ({
        label: field.label,
        value: field.displayValue,
        missing: field.missing,
      }))
    : detailsFromPreview(model.changePreview);
  return (
    <div className="box-border w-full max-w-full min-w-0 overflow-hidden rounded-lg border border-amber-200 bg-[#fffdf8] text-slate-950 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 px-3 pb-2.5 pt-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2" role="tablist" aria-label="Approval sections">
          {(["summary", "fields"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={
                "h-8 rounded-md border px-3 text-[13px] font-medium transition " +
                (tab === item
                  ? "border-amber-200 bg-amber-50 text-slate-950 shadow-sm"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")
              }
              onClick={() => setTab(item)}
            >
              {item === "summary" ? "Summary" : "Fields"}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pb-3 sm:px-4">
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700">
            Assigned to agent
          </div>
          <h3 className="mt-1 truncate text-lg font-semibold tracking-normal text-slate-950">
            {model.title}
          </h3>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-slate-600">
            {model.description}
          </p>
        </div>

        {tab === "summary" ? (
          <div className="grid min-w-0 grid-cols-1 gap-x-10 md:grid-cols-2">
            {metadata.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="grid min-h-9 min-w-0 grid-cols-[20px_minmax(88px,0.45fr)_minmax(0,1fr)] items-center gap-2 border-b border-slate-200/80 text-[13px]"
              >
                <Icon className="size-4 text-slate-700" />
                <span className="font-medium text-slate-500">{label}</span>
                <span className="truncate font-medium text-slate-950">{value}</span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "fields" ? (
          <div className="grid min-w-0 grid-cols-1">
            {detailRows.slice(0, 12).map((row) => (
              <div
                key={`${row.label}:${row.value}`}
                className="grid min-h-9 min-w-0 grid-cols-[minmax(112px,0.38fr)_minmax(0,1fr)] items-center gap-2 border-b border-slate-200/80 text-[13px]"
              >
                <span className="font-medium text-slate-500">{row.label}</span>
                <span className={`truncate font-medium ${row.missing ? "text-red-600" : "text-slate-950"}`}>
                  {row.missing ? "Not filled" : row.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 bg-white/70 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md border border-red-600 bg-red-600 px-3 text-[13px] font-semibold text-white transition hover:border-red-700 hover:bg-red-700 disabled:opacity-60"
            onClick={() => resume("reject")}
            disabled={Boolean(busy) || thread.isLoading}
          >
            <X className="size-3.5" />
            {busy === "reject" ? "Rejecting..." : "Reject"}
          </button>
          <button
            type="button"
            className="inline-flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md border border-slate-950 bg-slate-950 px-3 text-[13px] font-semibold text-white transition hover:border-slate-800 hover:bg-slate-800 disabled:opacity-60"
            onClick={() => resume("approve")}
            disabled={Boolean(busy) || thread.isLoading}
          >
            <Check className="size-3.5" />
            {busy === "approve" ? "Approving..." : model.approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
