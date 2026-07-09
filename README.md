# Writhing

The cursor for writing. Writhing is an AI-native document editor: a Google Docs-style rich text canvas with an AI assistant that can read your document, answer questions about it, and make edits you accept or reject as diffs.

## Features

- Rich text editor (headings, lists, quotes, inline formatting) built on TipTap.
- AI chat sidebar that always sees your current document and selection.
- The assistant edits your writing through tools:
  - `editDocument` — targeted find-and-replace edits
  - `insertText` — add text at the cursor or end of the document
  - `rewriteDocument` — full rewrites
- Every edit is shown as an inline red/green diff right in the document (Cursor-style), with Accept / Reject controls both in the document and in the chat.
- Your document autosaves to the browser (localStorage) — no account needed.

## Stack

- [Next.js](https://nextjs.org/) (App Router) + TypeScript + Tailwind CSS
- [Vercel AI SDK](https://sdk.vercel.ai/) (`ai`, `@ai-sdk/react`)
- [OpenRouter](https://openrouter.ai/) provider (`@openrouter/ai-sdk-provider`)
- [TipTap](https://tiptap.dev/) / ProseMirror for the editor

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your OpenRouter API key. Copy `.env.example` to `.env.local` and fill it in:

   ```bash
   cp .env.example .env.local
   # then edit .env.local and set OPENROUTER_API_KEY
   ```

   Get a key at https://openrouter.ai/keys. Optionally set `OPENROUTER_MODEL`
   to any tool-capable model id (defaults to `anthropic/claude-sonnet-4.5`).

3. Run the dev server:

   ```bash
   npm run dev
   ```

4. Open http://localhost:3000, start writing, and ask the assistant to help.

## How it works

The chat sidebar (`components/ChatSidebar.tsx`) uses `useChat` and, on every
request, attaches the editor's current plain text and selection to the request
body. The API route (`app/api/chat/route.ts`) puts that document into the system
prompt and exposes the editing tools defined in `lib/tools.ts`.

The tools have no server-side `execute`, so tool calls stream back to the
browser. Each proposed edit is rendered two ways: as an inline diff inside the
document (red for removed text, green for added text, via the ProseMirror marks
and widget buttons in `lib/diffExtensions.ts`) and as a card in the sidebar
(`components/EditDiff.tsx`). Accepting or rejecting from either place calls the
editor's imperative API (`components/Editor.tsx`) to finalize or revert the
change, then sends the result back to the model so it can continue.

## Roadmap ideas

- Inline Cmd+K edits directly in the document
- Tab autocomplete / next-sentence suggestions
- Multiple documents, database persistence, and accounts
