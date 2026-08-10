"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SourceDetailsDialog from "@/components/SourceDetailsDialog";
import {
  deleteSource,
  getPreviewUrl,
  listSources,
  requestProcessing,
  saveMetadata,
  uploadSource,
} from "@/lib/sources/api";
import {
  EMPTY_METADATA,
  titleFromFilename,
  type Source,
  type SourceMetadata,
  type SourceStatus,
} from "@/lib/sources/types";

/** How often to re-check sources that are still being processed. */
const POLL_MS = 3000;

const STATUS_STYLE: Record<SourceStatus, { label: string; className: string }> = {
  uploaded: { label: "Queued", className: "bg-white/[0.06] text-zinc-400" },
  processing: { label: "Processing", className: "bg-blue-500/15 text-blue-300" },
  ready: { label: "Ready", className: "bg-emerald-500/15 text-emerald-300" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-300" },
};

interface PendingUpload {
  file: File;
  metadata: SourceMetadata;
}

export default function SourceSidebar() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [editing, setEditing] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSources(await listSources());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sources");
    } finally {
      setLoaded(true);
    }
  }, []);

  // Inlined rather than calling refresh(), so the initial load can be cancelled
  // if the sidebar unmounts before it resolves.
  useEffect(() => {
    let cancelled = false;
    listSources()
      .then((rows) => {
        if (cancelled) return;
        setSources(rows);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load sources");
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll only while something is actually in flight, so an idle sidebar makes
  // no requests.
  const inFlight = sources.some(
    (s) => s.status === "uploaded" || s.status === "processing",
  );
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  const previewing = sources.find((s) => s.id === previewId) ?? null;

  // Signed URLs are short-lived, so fetch one when a preview opens rather than
  // holding them for every source in the list. Stored with the id it belongs to
  // so closing the preview needs no synchronous reset.
  useEffect(() => {
    if (!previewing) return;
    let cancelled = false;
    const { id } = previewing;
    void getPreviewUrl(previewing).then((url) => {
      if (!cancelled && url) setPreview({ id, url });
    });
    return () => {
      cancelled = true;
    };
  }, [previewing]);

  const previewUrl =
    previewing && preview?.id === previewing.id ? preview.url : null;

  function chooseFile(fileList: FileList | null) {
    if (!fileList?.length) return;
    const file = Array.from(fileList).find(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!file) {
      setError("Only PDF files can be added as sources.");
      return;
    }
    setError(null);
    setPending({
      file,
      metadata: { ...EMPTY_METADATA, title: titleFromFilename(file.name) },
    });
  }

  async function confirmUpload(metadata: SourceMetadata) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const created = await uploadSource(pending.file, metadata);
      setSources((prev) => [created, ...prev]);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEdit(metadata: SourceMetadata) {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await saveMetadata(editing.id, metadata);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save details");
    } finally {
      setBusy(false);
    }
  }

  async function remove(source: Source) {
    setSources((prev) => prev.filter((s) => s.id !== source.id));
    setPreviewId((current) => (current === source.id ? null : current));
    try {
      await deleteSource(source);
    } catch {
      await refresh();
    }
  }

  async function retry(source: Source) {
    try {
      await requestProcessing(source.id);
      setSources((prev) =>
        prev.map((s) =>
          s.id === source.id ? { ...s, status: "uploaded", errorMessage: null } : s,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the worker");
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        {previewing ? (
          <>
            <button
              type="button"
              onClick={() => setPreviewId(null)}
              title="Back to sources"
              className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path
                  d="M12.5 15L7.5 10L12.5 5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <h2 className="truncate text-sm font-semibold text-zinc-100">
              {previewing.metadata?.title || previewing.filename}
            </h2>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-zinc-100">Sources</h2>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 ring-1 ring-white/10">
              {sources.length}
            </span>
          </>
        )}
      </header>

      {previewing ? (
        <div className="min-h-0 flex-1 bg-zinc-900">
          {previewUrl ? (
            <iframe
              src={previewUrl}
              title={previewing.filename}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Loading preview…
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              chooseFile(e.dataTransfer.files);
            }}
            className={`flex-1 space-y-2 overflow-y-auto px-4 py-4 ${
              dragOver ? "bg-white/[0.03]" : ""
            }`}
          >
            {error && (
              <div className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {loaded && sources.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-white/[0.02] p-4 text-sm text-zinc-400">
                No sources yet. Upload a PDF to get started, or drag one in here.
              </div>
            )}

            {sources.map((source) => {
              const status = STATUS_STYLE[source.status];
              return (
                <div
                  key={source.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewId(source.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setPreviewId(source.id);
                  }}
                  className="group flex w-full cursor-pointer items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                      <path
                        d="M7 3.5h7l4 4V19.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5V5A1.5 1.5 0 0 1 7 3.5Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M14 3.5V7a1 1 0 0 0 1 1h3.5"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">
                      {source.metadata?.title || source.filename}
                    </span>
                    {source.metadata?.authors.length ? (
                      <span className="block truncate text-xs text-zinc-500">
                        {source.metadata.authors.join("; ")}
                        {source.metadata.year ? ` · ${source.metadata.year}` : ""}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                      {source.status === "ready" && (
                        <span className="text-[10px] text-zinc-500">
                          {source.evidenceCount} passages
                        </span>
                      )}
                    </span>
                    {source.status === "failed" && source.errorMessage && (
                      <span className="mt-1 block text-[11px] leading-snug text-red-300/80">
                        {source.errorMessage.slice(0, 140)}
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    {source.status === "failed" && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Retry processing"
                        onClick={(e) => {
                          e.stopPropagation();
                          void retry(source);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" || e.key === " ") void retry(source);
                        }}
                        className="rounded-md p-1 text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-200"
                      >
                        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                          <path
                            d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5V7H12"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      title="Edit details"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(source);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" || e.key === " ") setEditing(source);
                      }}
                      className="rounded-md p-1 text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-200"
                    >
                      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                        <path
                          d="M4 16l3.5-.8L15 7.7 12.3 5 4.8 12.5 4 16zM11.8 5.5l2.7 2.7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(source);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" || e.key === " ") void remove(source);
                      }}
                      className="rounded-md p-1 text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-200"
                    >
                      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                        <path
                          d="M5 5l10 10M15 5L5 15"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                chooseFile(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path
                  d="M10 4v9M6 8l4-4 4 4M4.5 15h11"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Upload PDF
            </button>
          </div>
        </>
      )}

      {pending && (
        <SourceDetailsDialog
          mode="upload"
          filename={pending.file.name}
          initial={pending.metadata}
          busy={busy}
          error={error}
          onCancel={() => {
            setPending(null);
            setError(null);
          }}
          onSubmit={(metadata) => void confirmUpload(metadata)}
        />
      )}

      {editing && (
        <SourceDetailsDialog
          mode="edit"
          filename={editing.filename}
          initial={editing.metadata ?? { ...EMPTY_METADATA, title: "" }}
          busy={busy}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSubmit={(metadata) => void confirmEdit(metadata)}
        />
      )}
    </div>
  );
}
