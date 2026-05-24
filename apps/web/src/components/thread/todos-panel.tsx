import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ListChecks,
  LoaderCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodoItem } from "@/providers/Stream";

const TODO_STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  completed: 3,
};

function orderedTodos(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    const aOrder = TODO_STATUS_ORDER[String(a.status)] ?? 2;
    const bOrder = TODO_STATUS_ORDER[String(b.status)] ?? 2;
    return aOrder - bOrder;
  });
}

function TodoIcon({ status }: { status: string }) {
  if (status === "completed") {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />;
  }

  if (status === "in_progress") {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-blue-600" />;
  }

  return <Circle className="size-3.5 shrink-0 text-muted-foreground" />;
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function TodosPanel({
  todos,
  expanded,
  onExpandedChange,
  attached = false,
}: {
  todos: TodoItem[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  attached?: boolean;
}) {
  if (!todos.length) return null;

  const current = todos.find((todo) => todo.status === "in_progress");
  const completedCount = todos.filter((todo) => todo.status === "completed").length;
  const pendingCount = todos.filter((todo) => todo.status === "pending").length;
  const summary = current?.content ?? `Tasks completed ${completedCount}/${todos.length}`;

  return (
    <section
      className={cn(
        "relative z-10 min-w-0 max-w-full overflow-hidden bg-background",
        attached
          ? "w-full border-b"
          : "mx-auto w-full max-w-3xl rounded-xl border shadow-xs",
      )}
      aria-label="Agent task progress"
    >
      <button
        type="button"
        className={cn(
          "flex w-full min-w-0 max-w-full items-center justify-between gap-3 overflow-hidden px-3 py-2 text-left transition-colors hover:bg-muted/60",
          expanded && "border-b",
        )}
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {current ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-blue-600" />
          ) : (
            <ListChecks className="size-4 shrink-0 text-emerald-600" />
          )}
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="text-xs font-semibold text-foreground">Tasks</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {current ? `Now: ${summary}` : summary}
            </div>
          </div>
        </div>
        <div className="flex max-w-[42%] shrink-0 items-center justify-end gap-2 overflow-hidden">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {completedCount}/{todos.length}
          </span>
          {pendingCount > 0 && current ? (
            <span className="hidden rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 sm:inline">
              {pendingCount} next
            </span>
          ) : null}
          {expanded ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded ? (
        <div className="max-h-44 min-w-0 overflow-y-auto overflow-x-hidden px-2 py-1.5">
          {orderedTodos(todos).map((todo, index) => {
            const status = String(todo.status);
            return (
              <div
                key={todo.id ?? `${todo.content}-${index}`}
                className={cn(
                  "flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-xs",
                  status === "in_progress" && "bg-blue-50 text-blue-950",
                  status === "completed" && "text-muted-foreground",
                )}
              >
                <TodoIcon status={status} />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "break-words break-all leading-snug",
                      status === "completed" && "line-through decoration-muted-foreground/60",
                    )}
                  >
                    {todo.content}
                  </div>
                  {status !== "pending" ? (
                    <div className="mt-0.5 text-[10px] uppercase text-muted-foreground">
                      {statusLabel(status)}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
