"use client";

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
  kind: EditKind;
  input: unknown;
  state: EditState;
  output?: string;
  errorText?: string;
  onAccept: () => void;
  onReject: () => void;
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
  kind,
  input,
  state,
  output,
  errorText,
  onAccept,
  onReject,
}: EditDiffProps) {
  const reason =
    input && typeof input === "object" && "reason" in input
      ? String((input as { reason?: unknown }).reason ?? "")
      : "";

  return (
    <div className="my-2 rounded-xl border border-[var(--border-subtle)] bg-white/[0.03] p-3 text-sm">
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

      {state === "input-available" && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onAccept}
            className="rounded-lg bg-emerald-500/90 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Accept
          </button>
          <button
            onClick={onReject}
            className="rounded-lg border border-white/10 px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5"
          >
            Reject
          </button>
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
