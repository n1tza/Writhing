"use client";

import { useRef } from "react";
import Editor, {
  type DiffHandlers,
  type EditorApi,
} from "@/components/Editor";
import ChatSidebar from "@/components/ChatSidebar";

export default function Home() {
  const editorApiRef = useRef<EditorApi | null>(null);
  const diffHandlersRef = useRef<DiffHandlers>({
    accept: () => {},
    reject: () => {},
  });

  return (
    <div className="flex h-screen w-full flex-col bg-zinc-100 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Writhing
          </span>
          <span className="text-xs text-zinc-400">the cursor for writing</span>
        </div>
        <span className="text-xs text-zinc-400">Saved locally</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
          <Editor apiRef={editorApiRef} diffHandlersRef={diffHandlersRef} />
        </main>
        <div className="w-[380px] shrink-0 border-l border-zinc-200 dark:border-zinc-800">
          <ChatSidebar
            editorApiRef={editorApiRef}
            diffHandlersRef={diffHandlersRef}
          />
        </div>
      </div>
    </div>
  );
}
