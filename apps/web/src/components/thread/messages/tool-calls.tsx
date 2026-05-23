import { AIMessage, ToolMessage } from "@langchain/langgraph-sdk";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  LoaderCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

function isComplexValue(value: any): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

type TodoToolItem = {
  id?: string;
  content?: string;
  status?: string;
};

function parseTodoToolArgs(args: unknown): TodoToolItem[] {
  let parsed = args;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (!parsed || typeof parsed !== "object") return [];

  const todos = (parsed as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return [];

  return todos.filter(
    (todo): todo is TodoToolItem => !!todo && typeof todo === "object",
  );
}

function TodoToolIcon({ status }: { status: string }) {
  if (status === "completed") {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />;
  }

  if (status === "in_progress") {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-blue-600" />;
  }

  return <Circle className="size-3.5 shrink-0 text-gray-400" />;
}

function TodoToolArgs({ args }: { args: unknown }) {
  const todos = parseTodoToolArgs(args);

  if (!todos.length) {
    return <code className="text-xs block p-2">{"{}"}</code>;
  }

  return (
    <div className="min-w-0 max-w-full divide-y divide-gray-200 overflow-hidden bg-white">
      {todos.map((todo, index) => {
        const status = String(todo.status ?? "pending");
        return (
          <div
            key={todo.id ?? `${todo.content ?? "todo"}-${index}`}
            className={cn(
              "flex min-w-0 items-start gap-2 px-3 py-2 text-xs",
              status === "in_progress" && "bg-blue-50",
              status === "completed" && "text-gray-500",
            )}
          >
            <TodoToolIcon status={status} />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "break-words break-all leading-snug",
                  status === "completed" && "line-through decoration-gray-400",
                )}
              >
                {todo.content ?? "(empty todo)"}
              </div>
              <div className="mt-0.5 text-[10px] uppercase text-gray-500">
                {status.replaceAll("_", " ")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ToolCalls({
  toolCalls,
}: {
  toolCalls: AIMessage["tool_calls"];
}) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="space-y-2 w-full max-w-full min-w-0 text-xs">
      {toolCalls.map((tc, idx) => {
        const args =
          tc.args && typeof tc.args === "object"
            ? (tc.args as Record<string, any>)
            : {};
        const hasArgs = Object.keys(args).length > 0;
        return (
          <div
            key={idx}
            className="w-full max-w-full min-w-0 overflow-hidden rounded-md border border-gray-200"
          >
            <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200">
              <h3 className="font-medium text-gray-900 text-xs leading-tight break-words">
                {tc.name}
                {tc.id && (
                  <code className="ml-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded break-all">
                    {tc.id}
                  </code>
                )}
              </h3>
            </div>
            {tc.name === "write_todos" ? (
              <TodoToolArgs args={args} />
            ) : hasArgs ? (
              <table className="w-full table-fixed divide-y divide-gray-200">
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(args).map(([key, value], argIdx) => (
                    <tr key={argIdx}>
                      <td className="w-24 px-3 py-1.5 text-xs font-medium text-gray-900 align-top break-all">
                        {key}
                      </td>
                      <td className="min-w-0 max-w-0 px-3 py-1.5 text-xs text-gray-600 align-top">
                        {isComplexValue(value) ? (
                          <code className="block max-w-full overflow-hidden bg-gray-50 rounded px-1.5 py-0.5 font-mono text-xs break-all whitespace-pre-wrap">
                            {JSON.stringify(value, null, 2)}
                          </code>
                        ) : (
                          <span className="block max-w-full break-all whitespace-pre-wrap">
                            {String(value)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <code className="text-xs block p-2">{"{}"}</code>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ToolResult({ message }: { message: ToolMessage }) {
  const [isExpanded, setIsExpanded] = useState(false);

  let parsedContent: any;
  let isJsonContent = false;

  try {
    if (typeof message.content === "string") {
      parsedContent = JSON.parse(message.content);
      isJsonContent = true;
    }
  } catch {
    // Content is not JSON, use as is
    parsedContent = message.content;
  }

  const contentStr = isJsonContent
    ? JSON.stringify(parsedContent, null, 2)
    : String(message.content);
  const contentLines = contentStr.split("\n");
  const shouldTruncate = contentLines.length > 4 || contentStr.length > 500;
  const displayedContent =
    shouldTruncate && !isExpanded
      ? contentStr.length > 500
        ? contentStr.slice(0, 500) + "..."
        : contentLines.slice(0, 4).join("\n") + "\n..."
      : contentStr;

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden rounded-md border border-gray-200 text-xs">
      <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {message.name ? (
            <h3 className="font-medium text-gray-900 text-xs leading-tight break-words">
              Tool Result:{" "}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs break-all">
                {message.name}
              </code>
            </h3>
          ) : (
            <h3 className="font-medium text-gray-900 text-sm">Tool Result</h3>
          )}
          {message.tool_call_id && (
            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded break-all">
              {message.tool_call_id}
            </code>
          )}
        </div>
      </div>
      <motion.div
        className="w-full min-w-0 bg-gray-100"
        initial={false}
        animate={{ height: "auto" }}
        transition={{ duration: 0.3 }}
      >
        <div className="p-2">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={isExpanded ? "expanded" : "collapsed"}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              {isJsonContent ? (
                <table className="w-full table-fixed divide-y divide-gray-200">
                  <tbody className="divide-y divide-gray-200">
                    {(Array.isArray(parsedContent)
                      ? isExpanded
                        ? parsedContent
                        : parsedContent.slice(0, 5)
                      : Object.entries(parsedContent)
                    ).map((item, argIdx) => {
                      const [key, value] = Array.isArray(parsedContent)
                        ? [argIdx, item]
                        : [item[0], item[1]];
                      return (
                        <tr key={argIdx}>
                          <td className="w-24 px-3 py-1.5 text-xs font-medium text-gray-900 align-top break-all">
                            {key}
                          </td>
                          <td className="min-w-0 max-w-0 px-3 py-1.5 text-xs text-gray-600 align-top">
                            {isComplexValue(value) ? (
                              <code className="block max-w-full overflow-hidden bg-gray-50 rounded px-1.5 py-0.5 font-mono text-xs break-all whitespace-pre-wrap">
                                {JSON.stringify(value, null, 2)}
                              </code>
                            ) : (
                              <span className="block max-w-full break-all whitespace-pre-wrap">
                                {String(value)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <code className="block max-w-full overflow-hidden text-xs whitespace-pre-wrap break-all">{displayedContent}</code>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        {((shouldTruncate && !isJsonContent) ||
          (isJsonContent &&
            Array.isArray(parsedContent) &&
            parsedContent.length > 5)) && (
          <motion.button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full py-1.5 flex items-center justify-center border-t-[1px] border-gray-200 text-gray-500 hover:text-gray-600 hover:bg-gray-50 transition-all ease-in-out duration-200 cursor-pointer"
            initial={{ scale: 1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isExpanded ? <ChevronUp /> : <ChevronDown />}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
