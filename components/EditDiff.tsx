"use client";

import { useState } from "react";
import type {
  EditDocumentInput,
  InsertTextInput,
  RewriteDocumentInput,
} from "@/lib/tools";

export type EditKind = "editDocument" | "insertText" | "rewriteDocument";

type EditState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

interface EditDiffProps {
  id: string;
  kind: EditKind;
  input: unknown;
  state: EditState;
  output?: string;
  errorText?: string;
  onAccept: () => void;
  onReject: () => void;
  refining: boolean;
  onStartRefine: () => void;
  onCancelRefine: () => void;
  onRefine: (feedback: string) => Promise<void>;
}

function Label({ kind }: { kind: EditKind }) {
  const text =
    kind === "editDocument"
      ? "Suggested edit"
      : kind === "insertText"
        ? "Suggested addition"
        : "Suggested rewrite";
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {text}
    </span>
  );
}

export default function EditDiff({
  id,
  kind,
  input,
  state,
  output,
  errorText,
  onAccept,
  onReject,
  refining,
  onStartRefine,
  onCancelRefine,
  onRefine,
}: EditDiffProps) {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reason =
    input && typeof input === "object" && "reason" in input
      ? String((input as { reason?: unknown }).reason ?? "")
      : "";

  const submitRefinement = async () => {
    const instruction = feedback.trim();
    if (!instruction || submitting) return;
    setSubmitting(true);
    try {
      await onRefine(instruction);
      setFeedback("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      id={`edit-diff-${id}`}
      className="my-2 rounded-xl border border-[var(--border-subtle)] bg-white/[0.03] p-3 text-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label kind={kind} />
        {state === "input-streaming" && (
          <span className="text-xs text-zinc-500">writing…</span>
        )}
      </div>

      {reason && <p className="mb-2 text-xs italic text-zinc-500">{reason}</p>}

      {kind === "editDocument" && (
        <div className="space-y-1 font-mono text-xs">
          <div className="whitespace-pre-wrap rounded-md bg-red-500/[0.12] px-2 py-1 text-red-300 line-through decoration-red-400/60">
            {(input as EditDocumentInput)?.find}
          </div>
          <div className="whitespace-pre-wrap rounded-md bg-emerald-500/[0.14] px-2 py-1 text-emerald-300">
            {(input as EditDocumentInput)?.replace}
          </div>
        </div>
      )}

      {kind === "insertText" && (
        <div className="whitespace-pre-wrap rounded-md bg-emerald-500/[0.14] px-2 py-1 font-mono text-xs text-emerald-300">
          {(input as InsertTextInput)?.text}
        </div>
      )}

      {kind === "rewriteDocument" && (
        <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-emerald-500/[0.14] px-2 py-1 font-mono text-xs text-emerald-300">
          {(input as RewriteDocumentInput)?.content}
        </div>
      )}

      {state === "input-available" && !refining && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onAccept}
            className="rounded-lg bg-emerald-500/90 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Accept
          </button>
          <button
            onClick={onStartRefine}
            className="rounded-lg border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20 hover:text-blue-200"
          >
            Refine
          </button>
          <button
            onClick={onReject}
            className="rounded-lg border border-white/10 px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
          >
            Reject
          </button>
        </div>
      )}

      {state === "input-available" && refining && (
        <div className="mt-3 rounded-lg border border-blue-400/15 bg-blue-500/[0.06] p-2">
          <label className="text-xs font-medium text-blue-200">
            How should Writhing adjust this suggestion?
            <textarea
              autoFocus
              rows={3}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  void submitRefinement();
                }
              }}
              placeholder="For example: make it more concise, keep the original tone, or use a stronger ending…"
              className="mt-2 w-full resize-none rounded-md border border-white/10 bg-black/15 px-2.5 py-2 text-xs leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-blue-400/35"
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={!feedback.trim() || submitting}
              onClick={() => void submitRefinement()}
              className="rounded-lg bg-blue-500/90 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Refining…" : "Generate replacement"}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setFeedback("");
                onCancelRefine();
              }}
              className="rounded-lg px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
            >
              Cancel
            </button>
            <span className="ml-auto text-[10px] text-zinc-600">
              ⌘/Ctrl + Enter
            </span>
          </div>
        </div>
      )}

      {state === "output-available" && (
        <p className="mt-2 text-xs font-medium text-zinc-500">{output}</p>
      )}

      {state === "output-error" && (
        <p className="mt-2 text-xs font-medium text-red-400">
          {errorText ?? "Something went wrong applying this edit."}
        </p>
      )}
    </div>
  );
}
