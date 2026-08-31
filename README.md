# Writhing

The cursor for writing. Writhing is an AI-native document editor for source-based
writing: a Google Docs-style canvas beside an assistant that has read your
uploaded PDFs, answers and edits only from what those sources actually say, and
shows you the passage behind every claim.

Every edit arrives as a diff you accept or reject. Every citation is a link that
opens the source PDF at the cited page, with the passage highlighted.

## Features

**Editing**

- Rich text editor (headings, lists, quotes, inline formatting, fonts, colors,
  pagination) built on TipTap/ProseMirror.
- Proposed edits render as inline red/green diffs in the document itself,
  Cursor-style, with Accept / Reject / Refine controls in both the document and
  the chat.
- Multi-step requests are broken into a visible task list the assistant works
  one item at a time, so you review each step instead of one large rewrite.
- Export to `.docx`, PDF, Markdown, or plain text.

**Sources and grounding**

- Upload PDFs with bibliographic metadata; a background worker parses, chunks,
  and embeds them into a retrievable evidence pool.
- Hybrid retrieval — dense vectors and full-text search fused with reciprocal
  rank fusion — over your sources and your own draft.
- Two chat modes, both grounded in that retrieval:
  - **Ask** answers in the chat, with each sentence bound to the passage ids
    that support it and rendered as clickable citation pills.
  - **Agent** edits the document, citing inline as `(Author, p.N)` and streaming
    back the passages it was working from.
- Citations open the PDF in-app at the right page, with the cited passage
  highlighted.

## Architecture

Three pieces, because they have genuinely different runtimes:

```
Next.js app  ──▶  Supabase (Postgres + pgvector, Storage, Auth)
     │                    ▲
     │                    │ writes evidence_units
     └──▶  Python document worker (Docling parse → chunk → embed)
```

- **`app/`, `components/`, `lib/`** — the Next.js App Router application. Two
  chat routes: `/api/chat` (streaming, tool-calling, Agent and Ask) and
  `/api/chat/grounded` (Ask's cited-JSON answers).
- **`packages/retrieval/`** — the retrieval layer as a standalone package:
  `SourceHybridRetriever` over uploaded sources, `DraftBlockRetriever` over the
  live document, and the RRF fusion between search legs. Callers embed the
  query; the retrievers never call an embedding API themselves.
- **`services/document-worker/`** — a Python HTTP worker that turns a PDF into
  evidence. Parsing a scanned document runs to minutes and needs Docling's
  Python stack, so it lives outside the Next process.
- **`supabase/migrations/`** — schema, row-level security, and the Postgres
  functions retrieval calls (`match_evidence_units`, `match_document_blocks`,
  `expand_evidence_context`, `save_document_blocks`).

There is no sign-in UI yet. Every table keys off `auth.uid()`, so the app signs
you in anonymously on first load — a real `auth.users` row that can later be
upgraded to an email account with `linkIdentity()`, keeping the documents and
sources it already owns.

## Getting started

You need Node 20+, Python 3.12+, a Supabase project, an
[OpenRouter](https://openrouter.ai/keys) key (generation), and an
[OpenAI](https://platform.openai.com/api-keys) key (embeddings).

**1. Install and configure the app**

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Generation, for both chat modes. |
| `OPENROUTER_MODEL` | Optional. Any tool-capable model id; defaults to `anthropic/claude-sonnet-4.5`. |
| `GROUNDED_MODEL` | Optional. Model for Ask mode; defaults to `anthropic/claude-sonnet-4.6`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-side Supabase key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side key; the retrievers use it to reach the RPC functions. |
| `OPENAI_API_KEY` | Query embeddings, which must match the worker's index-time model. |
| `WORKER_URL` | The document worker; defaults to `http://localhost:8000`. |

**2. Set up the database**

Apply the migrations in `supabase/migrations/` to your project (with the
Supabase CLI linked to it, `supabase db push`). They create the schema, enable
`pgvector`, create the private `source-pdfs` storage bucket with its
owner-scoped policies, and install the retrieval functions.

Anonymous sign-ins must be enabled on the project — it is how the app gets a
user. It is on by default in `supabase/config.toml` for local development; on a
hosted project, enable it under Authentication → Providers.

**3. Start the document worker**

```bash
cd services/document-worker
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py
```

The worker reads its own `services/document-worker/.env` (gitignored, no
example checked in) — create it with `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY`. The embedding model here must
stay `text-embedding-3-small` to match query time: vectors from different models
are not comparable, and the resulting degradation is silent.

It listens on `:8000` (`WORKER_PORT` to change it), with `GET /health` and
`POST /process`. The first run downloads Docling's models, which takes a while.

**4. Run the app**

```bash
npm run dev
```

Open http://localhost:3000. Upload a PDF in the source sidebar, wait for its
status to reach `ready`, then ask a question in Ask mode or ask for an edit in
Agent mode.

## How it works

**Ingestion.** An upload lands in Storage, then a `source_documents` row, then
the metadata you typed, and only then is the worker told to start — triggering
earlier would race the worker against its own input. The worker parses with
Docling, chunks paragraph-wise on real sentence boundaries (a mid-sentence cut
becomes a quotable fragment the model may cite, so the boundaries have to be
right), triages footnotes so pure reference apparatus is stored but never
retrieved, embeds with `text-embedding-3-small`, and writes `evidence_units`.
`source_documents.status` is the progress channel the UI polls.

**Retrieval.** `lib/ai/evidence.ts` is the single retrieval path for both chat
modes: build a query from the message plus any editor selection, embed it, then
run the source and draft retrievers in parallel. Each retriever fuses a vector
leg and a full-text leg with RRF.

Passages are retrieved small, read big, and cited small: the match is the
citable unit a page link points at, while the model reads that passage plus its
neighbours, so it can resolve references a passage opens with ("Such societies
need...").

**Generation.** Ask mode answers in a strict JSON schema of segments, each
carrying the evidence ids that support it; the route rejects any answer citing
an id that was not retrieved, so a fabricated citation cannot reach the UI.
Agent mode cannot bind claims to ids that way — it emits tool calls, not JSON —
so its grounding rule is carried in the prompt instead: claims come from a
retrieved passage and are cited inline as `(Author, p.N)`.

**Editing.** The editor tools in `lib/tools.ts` have no server-side `execute`,
so tool calls stream to the browser unresolved. Each proposed edit renders both
as an inline diff in the document (`lib/diffExtensions.ts`) and as a card in the
sidebar (`components/EditDiff.tsx`). Accepting or rejecting from either calls
the editor's imperative API (`components/Editor.tsx`) to finalize or revert, then
returns the result to the model so it can continue.

## Development

```bash
npm run dev      # dev server (copies pdf.js assets into public/ first)
npm run build    # production build
npm run lint     # eslint
npx vitest       # TypeScript unit tests
```

Worker tests:

```bash
cd services/document-worker && pytest
```

**Retrieval eval.** `packages/retrieval/eval/` holds a question set and a
harness that measures recall@5 and recall@10 against known passages, and exits
non-zero below 80% recall@5. Retrieval quality is the ceiling on answer quality,
so this gate is meant to be run before trusting generation:

```bash
npx tsx packages/retrieval/eval/run_eval.ts
```

`questions.json` references source ids and pages from a specific corpus — point
it at your own sources before reading the numbers as meaningful.

## Repository layout

```
app/                      Next.js App Router: pages and API routes
components/               Editor, chat sidebar, source sidebar, PDF viewer, diffs
lib/
  ai/                     Retrieval orchestration, prompts, schemas, embeddings
  editor/                 Autosave, block extraction, stable block ids
  sources/                Source upload/list API, citation channel, highlighting
  tools.ts                Editing tool definitions given to the model
packages/retrieval/       Hybrid retrieval package + eval harness
services/document-worker/ Python PDF → evidence pipeline
supabase/migrations/      Schema, RLS policies, retrieval functions
scripts/                  Build helpers (pdf.js asset copy)
```

## Roadmap ideas

- Inline Cmd+K edits directly in the document
- Tab autocomplete / next-sentence suggestions
- Bibliography generation from `bibliography_items` (CSL-JSON is already stored)
- Email accounts on top of the existing anonymous sessions
- Multiple documents per user
