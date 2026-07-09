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
    <div className="my-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label kind={kind} />
        {state === "input-streaming" && (
          <span className="text-xs text-zinc-400">writing…</span>
        )}
      </div>

      {reason && (
        <p className="mb-2 text-xs italic text-zinc-500">{reason}</p>
      )}

      {kind === "editDocument" && (
        <div className="space-y-1 font-mono text-xs">
          <div className="whitespace-pre-wrap rounded bg-red-500/10 px-2 py-1 text-red-700 line-through decoration-red-400/70 dark:text-red-300">
            {(input as EditDocumentInput)?.find}
          </div>
          <div className="whitespace-pre-wrap rounded bg-green-500/10 px-2 py-1 text-green-700 dark:text-green-300">
            {(input as EditDocumentInput)?.replace}
          </div>
        </div>
      )}

      {kind === "insertText" && (
        <div className="whitespace-pre-wrap rounded bg-green-500/10 px-2 py-1 font-mono text-xs text-green-700 dark:text-green-300">
          {(input as InsertTextInput)?.text}
        </div>
      )}

      {kind === "rewriteDocument" && (
        <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-green-500/10 px-2 py-1 font-mono text-xs text-green-700 dark:text-green-300">
          {(input as RewriteDocumentInput)?.content}
        </div>
      )}

      {state === "input-available" && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onAccept}
            className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-green-700"
          >
            Accept
          </button>
          <button
            onClick={onReject}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Reject
          </button>
        </div>
      )}

      {state === "output-available" && (
        <p className="mt-2 text-xs font-medium text-zinc-500">{output}</p>
      )}

      {state === "output-error" && (
        <p className="mt-2 text-xs font-medium text-red-500">
          {errorText ?? "Something went wrong applying this edit."}
        </p>
      )}
    </div>
  );
}
