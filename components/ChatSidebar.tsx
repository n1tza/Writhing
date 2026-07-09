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

const TOOL_TO_KIND: Record<string, EditKind> = {
  "tool-editDocument": "editDocument",
  "tool-insertText": "insertText",
  "tool-rewriteDocument": "rewriteDocument",
};

// Prefix on a tool result that signals the model should take another turn.
const RETRY_MARKER = "EDIT_FAILED:";

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
  const modeRef = useRef<ChatMode>("agent");
  const proposedRef = useRef<Set<string>>(new Set());
  const resolvedRef = useRef<Set<string>>(new Set());

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
            selection: api?.getSelectionText() ?? "",
            mode: modeRef.current,
          },
        };
      },
    }),
    // Only auto-continue the model's turn when an edit could not be located
    // (so it can retry). After a normal accept/reject we intentionally stop, to
    // avoid the model looping and re-adding text it already wrote.
    sendAutomaticallyWhen: (options) => {
      if (!lastAssistantMessageIsCompleteWithToolCalls(options)) return false;
      const lastAssistant = [...options.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (!lastAssistant) return false;
      const lastHasFailure = (lastAssistant.parts as ToolPart[]).some(
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

  // Show each new tool call as an inline diff in the document.
  useEffect(() => {
    const api = editorApiRef.current;
    if (!api) return;
    for (const message of messages) {
      for (const part of message.parts as ToolPart[]) {
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

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Assistant</h2>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 ring-1 ring-white/10">
          {mode}
        </span>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
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

        {messages.map((message) => (
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
          sendMessage({ text });
          setInput("");
        }}
        className="p-3"
      >
        <div className="rounded-xl border border-[var(--border-subtle)] bg-white/[0.03] p-1.5 transition-colors focus-within:border-white/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const text = input.trim();
                if (!text || busy) return;
                sendMessage({ text });
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
