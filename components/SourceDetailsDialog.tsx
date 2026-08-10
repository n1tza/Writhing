"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatAuthors,
  normalizeDoi,
  parseAuthors,
  type SourceMetadata,
} from "@/lib/sources/types";

const FIELD_CLASS =
  "w-full rounded-lg border border-[var(--border-subtle)] bg-white/[0.03] px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-white/25 focus:bg-white/[0.05]";
const LABEL_CLASS = "block text-[11px] font-medium uppercase tracking-wide text-zinc-500";

export interface SourceDetailsDialogProps {
  filename: string;
  initial: SourceMetadata;
  /** "upload" adds a source; "edit" changes one already stored. */
  mode: "upload" | "edit";
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (metadata: SourceMetadata) => void;
}

export default function SourceDetailsDialog({
  filename,
  initial,
  mode,
  busy = false,
  error = null,
  onCancel,
  onSubmit,
}: SourceDetailsDialogProps) {
  const [title, setTitle] = useState(initial.title);
  const [authors, setAuthors] = useState(formatAuthors(initial.authors));
  const [year, setYear] = useState(initial.year ? String(initial.year) : "");
  const [journal, setJournal] = useState(initial.journal ?? "");
  const [publisher, setPublisher] = useState(initial.publisher ?? "");
  const [doi, setDoi] = useState(initial.doi ?? "");
  const [url, setUrl] = useState(initial.url ?? "");
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsedYear = Number.parseInt(year, 10);
    onSubmit({
      title: title.trim(),
      authors: parseAuthors(authors),
      // A year outside this range is a typo, not a date.
      year: Number.isFinite(parsedYear) && parsedYear > 1000 && parsedYear < 2200
        ? parsedYear
        : null,
      journal: journal.trim() || null,
      publisher: publisher.trim() || null,
      doi: normalizeDoi(doi),
      url: url.trim() || null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "upload" ? "Source details" : "Edit source details"}
        className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-zinc-900 p-5 shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-zinc-100">
          {mode === "upload" ? "Source details" : "Edit source"}
        </h2>
        <p className="mt-1 truncate text-xs text-zinc-500" title={filename}>
          {filename}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Used for citations and the bibliography. These can&apos;t be read from
          the PDF reliably, and you can change them later.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className={LABEL_CLASS} htmlFor="source-title">
              Title
            </label>
            <input
              id="source-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Gorbachev and Yeltsin: Personalities and Beliefs"
              className={`mt-1 ${FIELD_CLASS}`}
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="source-authors">
              Authors
            </label>
            <input
              id="source-authors"
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="Breslauer, George W.; Brown, Archie"
              className={`mt-1 ${FIELD_CLASS}`}
            />
            <p className="mt-1 text-[11px] text-zinc-600">
              Separate multiple authors with a semicolon.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS} htmlFor="source-year">
                Year
              </label>
              <input
                id="source-year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                placeholder="2002"
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="source-doi">
                DOI
              </label>
              <input
                id="source-doi"
                value={doi}
                onChange={(e) => setDoi(e.target.value)}
                placeholder="10.1017/CBO9780511815423"
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS} htmlFor="source-journal">
                Journal
              </label>
              <input
                id="source-journal"
                value={journal}
                onChange={(e) => setJournal(e.target.value)}
                placeholder="Europe-Asia Studies"
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="source-publisher">
                Publisher
              </label>
              <input
                id="source-publisher"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
                placeholder="Cambridge University Press"
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="source-url">
              URL
            </label>
            <input
              id="source-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className={`mt-1 ${FIELD_CLASS}`}
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
          >
            {busy
              ? mode === "upload"
                ? "Uploading…"
                : "Saving…"
              : mode === "upload"
                ? "Upload"
                : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
