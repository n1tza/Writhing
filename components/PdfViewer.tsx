"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { findPassage } from "@/lib/sources/highlight";

export interface PdfViewerProps {
  url: string;
  /** 1-based page to show. Controlled: the parent owns it. */
  page: number;
  /** Passage to highlight on that page, if any. */
  highlight?: string | null;
  onPageChange: (page: number) => void;
}

/**
 * A PDF page renderer, used instead of an <iframe> so a citation can highlight
 * the passage it cites. The browser's built-in viewer has no API for that —
 * Chrome and Firefox honour a `#search=` hash but Safari does not — so the page
 * is drawn to a canvas with pdf.js and its text layer rendered on top.
 */
export default function PdfViewer({
  url,
  page,
  highlight,
  onPageChange,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);

  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<boolean | null>(null);

  // No local copy of the page: the parent owns it, so opening a citation and
  // pressing the arrows go through the same path and cannot disagree.
  const current = Math.min(Math.max(page, 1), pageCount || page);

  // Load the document once per URL.
  useEffect(() => {
    let cancelled = false;
    // Teardown goes through the loading task, not the document: in pdf.js 6 the
    // task owns the worker, and destroying it is what releases it.
    let task: PDFDocumentLoadingTask | null = null;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // The worker ships as an ESM module beside the library; resolving it
        // relative to this module lets the bundler emit it rather than us
        // copying a build artefact into /public and keeping it in sync.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        task = pdfjs.getDocument({
          url,
          // Served from public/ by the prebuild copy step. Without it, PDFs
          // that reference the standard 14 fonts without embedding them render
          // with fallback glyphs — which both indexed sources do.
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        });
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not open this PDF");
        }
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
      docRef.current = null;
    };
  }, [url]);

  /** Renders the current page; resolves to whether the passage was located. */
  const renderPage = useCallback(async (): Promise<boolean | null> => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!doc || !canvas || !textLayer) return null;

    const pdfPage = await doc.getPage(Math.min(Math.max(current, 1), doc.numPages));

    // Render at device resolution so text stays sharp, but lay the canvas out
    // at CSS size so the text layer lines up with it.
    const container = containerRef.current;
    const targetWidth = (container?.clientWidth ?? 800) - 24;
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const viewport = pdfPage.getViewport({ scale });
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const context = canvas.getContext("2d");
    if (!context) return null;

    // pdf.js 6 requires the canvas itself; the device-pixel-ratio scale goes
    // through `transform` rather than a setTransform it would overwrite.
    await pdfPage.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    }).promise;

    // Text layer, positioned over the canvas. pdf.js sizes each span from
    // --total-scale-factor; without it every font-size and transform resolves
    // against an undefined variable and the spans land nowhere near the glyphs.
    textLayer.replaceChildren();
    textLayer.style.setProperty("--total-scale-factor", String(scale));

    const pdfjs = await import("pdfjs-dist");
    const layer = new pdfjs.TextLayer({
      textContentSource: await pdfPage.getTextContent(),
      container: textLayer,
      viewport,
    });
    await layer.render();

    if (!highlight) return null;

    // Walk the rendered spans as one string, locate the passage, and mark every
    // span it touches. Span-level rather than character-level: the text layer
    // positions each span absolutely, so a background on the span sits exactly
    // over the glyphs without needing to measure inside it.
    // Leaf spans only. pdf.js wraps runs in `.markedContent` spans, and a
    // wrapper's textContent repeats its children's — counting both duplicates
    // the page text and shifts every offset.
    const spans = Array.from(
      textLayer.querySelectorAll<HTMLElement>("span"),
    ).filter((s) => s.childElementCount === 0 && s.textContent);

    let pageText = "";
    const spanRanges: { span: HTMLElement; start: number; end: number }[] = [];
    for (const span of spans) {
      const text = span.textContent ?? "";
      spanRanges.push({ span, start: pageText.length, end: pageText.length + text.length });
      pageText += text;
    }

    const range = findPassage(pageText, highlight);
    if (!range) return false;

    let first: HTMLElement | null = null;
    for (const { span, start, end } of spanRanges) {
      if (end <= range.start || start >= range.end) continue;
      span.classList.add("pdf-cited");
      if (!first) first = span;
    }
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }, [current, highlight]);

  useEffect(() => {
    // Guarded so a slow render for a page you have already left cannot report
    // its result over the current one.
    let cancelled = false;
    renderPage()
      .then((located) => {
        if (!cancelled) setFound(located);
      })
      .catch(() => {
        if (!cancelled) setFound(null);
      });
    return () => {
      cancelled = true;
    };
  }, [renderPage, pageCount]);

  function go(next: number) {
    onPageChange(Math.min(Math.max(next, 1), pageCount || 1));
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 text-xs text-zinc-500">
        <button
          type="button"
          onClick={() => go(current - 1)}
          disabled={current <= 1}
          className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-30"
        >
          ‹
        </button>
        <span className="tabular-nums">
          {current} / {pageCount || "…"}
        </span>
        <button
          type="button"
          onClick={() => go(current + 1)}
          disabled={pageCount > 0 && current >= pageCount}
          className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-30"
        >
          ›
        </button>
        {highlight && found === false && (
          <span className="ml-auto text-amber-400/80">
            cited passage not found on this page
          </span>
        )}
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-3">
        <div className="relative mx-auto w-fit">
          <canvas ref={canvasRef} className="block shadow-lg" />
          <div
            ref={textLayerRef}
            className="pdf-text-layer absolute left-0 top-0"
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
