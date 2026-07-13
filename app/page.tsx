"use client";

import { useEffect, useRef, useState } from "react";
import Editor, {
  type DiffHandlers,
  type EditorApi,
} from "@/components/Editor";
import ChatSidebar from "@/components/ChatSidebar";

const SIDEBAR_WIDTH_KEY = "writhing:sidebarWidth";
const MIN_WIDTH = 300;
const DEFAULT_WIDTH = 380;

export default function Home() {
  const editorApiRef = useRef<EditorApi | null>(null);
  const diffHandlersRef = useRef<DiffHandlers>({
    accept: () => {},
    reject: () => {},
  });

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);

  const clampWidth = (width: number) => {
    const max = Math.max(MIN_WIDTH, window.innerWidth - 360);
    return Math.min(Math.max(width, MIN_WIDTH), max);
  };

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) setSidebarWidth(clampWidth(parsed));
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      setSidebarWidth(clampWidth(window.innerWidth - e.clientX));
    };
    const onUp = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  return (
    <div className="flex h-screen w-full flex-col bg-[var(--app-bg)] text-[var(--text-primary)]">
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] text-[13px] font-semibold text-zinc-100 ring-1 ring-white/10">
            W
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight text-zinc-100">
              Writhing
            </span>
            <span className="text-xs text-zinc-500">the cursor for writing</span>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
          Saved locally
        </span>
      </header>

      <div className="flex min-h-0 flex-1 gap-1.5 px-2 pb-2">
        <main className="min-h-0 flex-1 overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--doc-canvas)]">
          <Editor apiRef={editorApiRef} diffHandlersRef={diffHandlersRef} />
        </main>

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDoubleClick={() => setSidebarWidth(DEFAULT_WIDTH)}
          title="Drag to resize (double-click to reset)"
          className="group relative flex w-1.5 shrink-0 cursor-col-resize items-center justify-center"
        >
          <div
            className={`h-10 w-1 rounded-full transition-colors ${
              dragging
                ? "bg-blue-500"
                : "bg-white/10 group-hover:bg-white/25"
            }`}
          />
        </div>

        <aside
          style={{ width: sidebarWidth }}
          className="shrink-0 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--panel-bg)]"
        >
          <ChatSidebar
            editorApiRef={editorApiRef}
            diffHandlersRef={diffHandlersRef}
          />
        </aside>
      </div>
    </div>
  );
}
