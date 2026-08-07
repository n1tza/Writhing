"use client";

import { useEffect, useRef, useState } from "react";

type Source = {
  id: string;
  name: string;
  size: number;
  url: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SourceSidebar() {
  const [sources, setSources] = useState<Source[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sourcesRef = useRef<Source[]>([]);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  // Revoke every object URL on unmount to avoid leaking blobs.
  useEffect(() => {
    return () => {
      sourcesRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const additions: Source[] = [];
    for (const file of Array.from(fileList)) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }
      additions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file),
      });
    }
    if (additions.length > 0) setSources((prev) => [...prev, ...additions]);
  }

  function removeSource(id: string) {
    setSources((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
    setPreviewId((current) => (current === id ? null : current));
  }

  const previewing = sources.find((s) => s.id === previewId) ?? null;

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
              {previewing.name}
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
          <iframe
            src={previewing.url}
            title={previewing.name}
            className="h-full w-full border-0"
          />
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
              addFiles(e.dataTransfer.files);
            }}
            className={`flex-1 space-y-2 overflow-y-auto px-4 py-4 ${
              dragOver ? "bg-white/[0.03]" : ""
            }`}
          >
            {sources.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-white/[0.02] p-4 text-sm text-zinc-400">
                No sources yet. Upload a PDF to get started, or drag one in
                here.
              </div>
            )}

            {sources.map((source) => (
              <div
                key={source.id}
                role="button"
                tabIndex={0}
                onClick={() => setPreviewId(source.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setPreviewId(source.id);
                }}
                className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
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
                    <text
                      x="12"
                      y="16.5"
                      textAnchor="middle"
                      fontSize="6.5"
                      fontWeight="700"
                      fill="currentColor"
                      stroke="none"
                    >
                      PDF
                    </text>
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-200">
                    {source.name}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {formatSize(source.size)}
                  </span>
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  title="Remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSource(source.id);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" || e.key === " ") removeSource(source.id);
                  }}
                  className="shrink-0 rounded-md p-1 text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-zinc-200 group-hover:opacity-100"
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
              </div>
            ))}
          </div>

          <div className="p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
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
    </div>
  );
}
