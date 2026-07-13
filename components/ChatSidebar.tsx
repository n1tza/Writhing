"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { marked } from "marked";
import type { DiffHandlers, EditKind, EditorApi } from "@/components/Editor";
import EditDiff from "@/components/EditDiff";
import TaskList, { type Task } from "@/components/TaskList";

const TOOL_TO_KIND: Record<string, EditKind> = {
  "tool-editDocument": "editDocument",
  "tool-insertText": "insertText",
  "tool-rewriteDocument": "rewriteDocument",
};

// Prefix on a tool result that signals the model should take another turn.
const RETRY_MARKER = "EDIT_FAILED:";
// Prefix on internal messages we inject to drive the task loop. These are sent
// to the model but hidden from the chat transcript in the UI.
const CONTROL_PREFIX = "::WRITHING_TASK:: ";

function extractTaskTitles(input: unknown): string[] {
  if (!input || typeof input !== "object" || !("tasks" in input)) return [];
  const raw = (input as { tasks?: unknown }).tasks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());
}

// The AI SDK accumulates a whole conversation turn (multiple tool round-trips)
// into ONE assistant message, delimited by "step-start" parts. We only care
// about the latest step when deciding whether the current task is finished.
function lastStep(parts: { type: string }[]): {
  startIndex: number;
  parts: ToolPart[];
} {
  let startIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].type === "step-start") startIndex = i;
  }
  return { startIndex, parts: parts.slice(startIndex + 1) as ToolPart[] };
}

type ChatMode = "agent" | "ask";

function renderMarkdown(text: string): { __html: string } {
  return { __html: marked.parse(text, { async: false, breaks: true }) };
}

type ToolPart = {
  type: string;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: string;
  errorText?: string;
};

export default function ChatSidebar({
  editorApiRef,
  diffHandlersRef,
}: {
  editorApiRef: MutableRefObject<EditorApi | null>;
  diffHandlersRef: MutableRefObject<DiffHandlers>;
}) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("agent");
  const [tasks, setTasks] = useState<Task[]>([]);
  const modeRef = useRef<ChatMode>("agent");
  const proposedRef = useRef<Set<string>>(new Set());
  const resolvedRef = useRef<Set<string>>(new Set());
  // planTasks tool calls we've already turned into a task list.
  const planHandledRef = useRef<Set<string>>(new Set());
  // Assistant messages we've already advanced past (avoids double-advancing).
  const advancedFromRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const { messages, sendMessage, addToolOutput, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages }) => {
        const api = editorApiRef.current;
        return {
          body: {
            messages,
            document: api?.getPlainText() ?? "",
            documentHtml: api?.getHtml() ?? "",
            selection: api?.getSelectionText() ?? "",
            mode: modeRef.current,
          },
        };
      },
    }),
    // Auto-continue the model's turn when (a) it just produced a task plan (so
    // it can start task 1), or (b) an edit could not be located (so it can
    // retry). After a normal accept/reject we intentionally stop, to avoid the
    // model looping and re-adding text it already wrote — task-to-task advancing
    // is driven explicitly once the current task's diffs are resolved.
    sendAutomaticallyWhen: (options) => {
      if (!lastAssistantMessageIsCompleteWithToolCalls(options)) return false;
      const lastAssistant = [...options.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (!lastAssistant) return false;
      const stepParts = lastStep(lastAssistant.parts).parts;
      // Kickoff: the model just created a plan (and made no edits) in this step.
      // Continue so it starts working the first task.
      const hasPlan = stepParts.some((p) => p.type === "tool-planTasks");
      const hasEdit = stepParts.some((p) => TOOL_TO_KIND[p.type]);
      if (hasPlan && !hasEdit) return true;
      const lastHasFailure = stepParts.some(
        (p) => typeof p.output === "string" && p.output.startsWith(RETRY_MARKER),
      );
      if (!lastHasFailure) return false;
      // Cap total auto-retries so a genuinely-missing snippet can't loop forever.
      const totalFailures = options.messages
        .flatMap((m) => m.parts as ToolPart[])
        .filter(
          (p) =>
            typeof p.output === "string" && p.output.startsWith(RETRY_MARKER),
        ).length;
      return totalFailures < 3;
    },
  });

  const busy = status === "submitted" || status === "streaming";

  function kindOf(toolCallId: string): EditKind | null {
    for (const message of messages) {
      for (const part of message.parts as ToolPart[]) {
        if (part.toolCallId === toolCallId && TOOL_TO_KIND[part.type]) {
          return TOOL_TO_KIND[part.type];
        }
      }
    }
    return null;
  }

  function handleAccept(toolCallId: string) {
    if (resolvedRef.current.has(toolCallId)) return;
    const kind = kindOf(toolCallId);
    if (!kind) return;
    resolvedRef.current.add(toolCallId);
    editorApiRef.current?.acceptDiff(toolCallId);
    addToolOutput({
      tool: kind,
      toolCallId,
      output:
        "The user accepted this edit and it is now in the document. This request is complete. Do not call any more tools or re-add this text unless the user asks for something new.",
    });
  }

  function handleReject(toolCallId: string) {
    if (resolvedRef.current.has(toolCallId)) return;
    const kind = kindOf(toolCallId);
    if (!kind) return;
    resolvedRef.current.add(toolCallId);
    editorApiRef.current?.rejectDiff(toolCallId);
    addToolOutput({
      tool: kind,
      toolCallId,
      output:
        "The user rejected this edit. The document was left unchanged. This request is complete. Do not retry the same edit or call more tools unless the user asks for something new.",
    });
  }

  // Keep the in-document Accept/Reject buttons wired to the latest handlers.
  useEffect(() => {
    diffHandlersRef.current = {
      accept: handleAccept,
      reject: handleReject,
    };
  });

  // Show each new tool call as an inline diff in the document; turn planTasks
  // calls into a task list and kick off the first task.
  useEffect(() => {
    const api = editorApiRef.current;
    if (!api) return;
    for (const message of messages) {
      for (const part of message.parts as ToolPart[]) {
        if (part.type === "tool-planTasks" && part.state === "input-available") {
          const id = part.toolCallId;
          if (planHandledRef.current.has(id)) continue;
          const titles = extractTaskTitles(part.input);
          if (titles.length === 0) continue;
          planHandledRef.current.add(id);
          setTasks(
            titles.map((title, i) => ({
              title,
              status: i === 0 ? "in_progress" : "pending",
            })),
          );
          addToolOutput({
            tool: "planTasks",
            toolCallId: id,
            output: `Task list created with ${titles.length} tasks. Work ONLY on task 1 of ${titles.length}: "${titles[0]}". Make its edits now, then stop and wait. Do not start any other task.`,
          });
          continue;
        }

        const kind = TOOL_TO_KIND[part.type];
        if (!kind || part.state !== "input-available") continue;
        const id = part.toolCallId;
        if (proposedRef.current.has(id) || resolvedRef.current.has(id)) continue;
        proposedRef.current.add(id);
        const shown = api.proposeEdit(id, kind, part.input);
        if (!shown) {
          resolvedRef.current.add(id);
          addToolOutput({
            tool: kind,
            toolCallId: id,
            output: `${RETRY_MARKER} Could not locate the exact text to change, so no diff was shown. Re-read the current document text and call the tool again with a shorter, exact snippet copied verbatim.`,
          });
        }
      }
    }
  }, [messages, editorApiRef, addToolOutput]);

  // Once the current task's diffs are all resolved (and the model is idle),
  // mark it done and prompt the model to work the next task. This is what makes
  // the agent complete a multi-step request one task at a time.
  useEffect(() => {
    if (busy || tasks.length === 0) return;
    const currentIndex = tasks.findIndex((t) => t.status === "in_progress");
    if (currentIndex === -1) return;

    let lastAssistant: (typeof messages)[number] | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        lastAssistant = messages[i];
        break;
      }
    }
    if (!lastAssistant) return;

    const { startIndex, parts: stepParts } = lastStep(lastAssistant.parts);
    const hasPlan = stepParts.some((p) => p.type === "tool-planTasks");
    const editParts = stepParts.filter((p) => TOOL_TO_KIND[p.type]);
    // The plan/kickoff step (no edits yet) is advanced by the kickoff
    // auto-continue, not here — wait for the model to actually work the task.
    if (hasPlan && editParts.length === 0) return;

    const allResolved = editParts.every(
      (p) => p.state === "output-available" || p.state === "output-error",
    );
    if (!allResolved) return;
    // Key on the message + step so we advance exactly once per completed step,
    // even though every task shares the same accumulating assistant message.
    const advanceKey = `${lastAssistant.id}#${startIndex}`;
    if (advancedFromRef.current.has(advanceKey)) return;
    advancedFromRef.current.add(advanceKey);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= tasks.length) {
      setTasks((prev) =>
        prev.map((t, i) =>
          i === currentIndex ? { ...t, status: "done" } : t,
        ),
      );
      return;
    }

    const nextTitle = tasks[nextIndex].title;
    setTasks((prev) =>
      prev.map((t, i) =>
        i === currentIndex
          ? { ...t, status: "done" }
          : i === nextIndex
            ? { ...t, status: "in_progress" }
            : t,
      ),
    );
    sendMessage({
      text: `${CONTROL_PREFIX}The previous task's edits are now in the document (see the CURRENT DOCUMENT). Work ONLY on task ${nextIndex + 1} of ${tasks.length}: "${nextTitle}". Make its edits now, then stop. Copy any 'find' text verbatim from the current document.`,
    });
  }, [busy, tasks, messages, sendMessage]);

  // Start a brand-new request from the user: clear any prior task state.
  function submitUserMessage(text: string) {
    setTasks([]);
    planHandledRef.current = new Set();
    advancedFromRef.current = new Set();
    sendMessage({ text });
  }

  function isControlMessage(message: (typeof messages)[number]): boolean {
    if (message.role !== "user") return false;
    return (message.parts as { type: string; text?: string }[]).some(
      (p) =>
        p.type === "text" &&
        typeof p.text === "string" &&
        p.text.startsWith(CONTROL_PREFIX),
    );
  }

  // Dedupe on id (the SDK can briefly surface a duplicate assistant message
  // while auto-resubmitting) and drop the internal task-advance control
  // messages, so React keys stay unique.
  const lastIndexById = new Map<string, number>();
  messages.forEach((m, i) => lastIndexById.set(m.id, i));
  const visibleMessages = messages.filter(
    (m, i) => lastIndexById.get(m.id) === i && !isControlMessage(m),
  );

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Assistant</h2>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 ring-1 ring-white/10">
          {mode}
        </span>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {tasks.length > 0 && <TaskList tasks={tasks} />}

        {messages.length === 0 && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] p-4 text-sm text-zinc-400">
            Try asking:
            <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-zinc-600">
              <li>&ldquo;Tighten the first paragraph.&rdquo;</li>
              <li>&ldquo;Add a concluding sentence.&rdquo;</li>
              <li>&ldquo;What&rsquo;s the tone of this piece?&rdquo;</li>
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              Edits appear as diffs in your document &mdash; accept or reject
              them there or here.
            </p>
          </div>
        )}

        {visibleMessages.map((message) => (
          <div key={message.id} className="text-sm">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {message.role === "user" ? "You" : "Writhing"}
            </div>
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                if (message.role === "user") {
                  return (
                    <p
                      key={index}
                      className="whitespace-pre-wrap rounded-xl bg-white/[0.05] px-3 py-2 leading-relaxed text-zinc-200"
                    >
                      {part.text}
                    </p>
                  );
                }
                return (
                  <div
                    key={index}
                    className="chat-prose text-zinc-300"
                    dangerouslySetInnerHTML={renderMarkdown(part.text)}
                  />
                );
              }

              const kind = TOOL_TO_KIND[part.type];
              if (kind && "toolCallId" in part) {
                const toolPart = part as ToolPart;
                const displayOutput = toolPart.output?.startsWith(RETRY_MARKER)
                  ? "Couldn't find that text — trying again…"
                  : toolPart.output;
                return (
                  <EditDiff
                    key={toolPart.toolCallId}
                    kind={kind}
                    input={toolPart.input}
                    state={toolPart.state}
                    output={displayOutput}
                    errorText={toolPart.errorText}
                    onAccept={() => handleAccept(toolPart.toolCallId)}
                    onReject={() => handleReject(toolPart.toolCallId)}
                  />
                );
              }

              return null;
            })}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
            Writhing is thinking…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text || busy) return;
          submitUserMessage(text);
          setInput("");
        }}
        className="p-3"
      >
        <div className="ui-focus-ring rounded-xl border border-[var(--border-subtle)] bg-white/[0.03] p-1.5 focus-within:border-white/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const text = input.trim();
                if (!text || busy) return;
                submitUserMessage(text);
                setInput("");
              }
            }}
            rows={3}
            placeholder={
              mode === "agent"
                ? "Ask Writhing to write or edit…"
                : "Ask a question about your writing…"
            }
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex rounded-lg bg-white/[0.04] p-0.5 text-xs font-medium ring-1 ring-white/[0.06]">
              {(["agent", "ask"] as ChatMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  title={
                    m === "agent"
                      ? "Agent can edit your document"
                      : "Ask answers without editing"
                  }
                  className={
                    mode === m
                      ? "rounded-md bg-white/10 px-2.5 py-1 capitalize text-zinc-100 shadow-sm"
                      : "rounded-md px-2.5 py-1 capitalize text-zinc-500 transition-colors hover:text-zinc-200"
                  }
                >
                  {m}
                </button>
              ))}
            </div>

            {busy ? (
              <button
                type="button"
                onClick={() => stop()}
                className="flex items-center justify-center gap-2 rounded-lg bg-red-500/90 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
              >
                <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-white" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim().length === 0}
                className="rounded-lg bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
