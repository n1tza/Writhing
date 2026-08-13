import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { SourceHybridRetriever, DraftBlockRetriever } from '@writhing/retrieval'
import { embedQuery } from '@/lib/ai/embed'
import { buildRetrievalQuery } from '@/lib/ai/build-query'
import { buildChatPrompt, CHAT_SYSTEM_PROMPT } from '@/lib/ai/prompts'
import { ChatResponseSchema } from '@/lib/ai/schema'

// Claude, reached through OpenRouter so the app keeps one provider and one key.
// OpenRouter namespaces model IDs and uses dotted versions, so this is not the
// same string as the first-party Anthropic API id.
const MODEL = process.env.GROUNDED_MODEL ?? 'anthropic/claude-sonnet-4.6'

// Clients are built per request rather than at module scope: constructing them
// at import time throws during Next's build-time page-data collection, because
// the API keys are not present in the build environment.

// Retrieval, embedding, and generation in series.
export const maxDuration = 60

function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/)
  return fenced ? fenced[1] : text
}

export async function POST(req: Request) {
  try {
    return await handle(req)
  } catch (error) {
    // Without this, an unhandled throw returns Next's HTML error page and the
    // client's response.json() fails with an opaque parser message instead of
    // the real cause.
    console.error('Grounded chat failed:', error)
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return Response.json({ error: message }, { status: 500 })
  }
}

async function handle(req: Request) {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
  const sourceRetriever = new SourceHybridRetriever()
  const draftRetriever = new DraftBlockRetriever()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    message,
    documentId,
    sourceIds,
    selectedText,
  }: {
    message: string
    documentId: string
    sourceIds: string[]
    selectedText: string | null
  } = await req.json()

  // 1. Build retrieval query from selected text + message
  const retrievalQuery = buildRetrievalQuery(message, selectedText)

  // 2. Embed the query
  const embedding = await embedQuery(retrievalQuery)

  // 3. Retrieve evidence and draft blocks in parallel
  const [evidenceResults, draftResults] = await Promise.all([
    sourceRetriever.retrieve({
      query: retrievalQuery,
      queryEmbedding: embedding,
      documentId,
      sourceIds,
      topK: 5,
      includeEvidence: true,
      includeDraft: false,
    }),
    draftRetriever.retrieve({
      query: retrievalQuery,
      queryEmbedding: embedding,
      documentId,
      sourceIds: [],
      topK: 3,
      includeEvidence: false,
      includeDraft: true,
    }),
  ])

  // 4. Build the prompt.
  //
  // contextText, not text: the model reads the passage plus its neighbours so it
  // can resolve references the passage opens with ("Such societies need..."),
  // while the citation still points at the exact matched paragraph.
  const evidence = evidenceResults
    .filter(r => r.citable)
    .map(r => ({
      id: r.id,
      sourceId: r.sourceId,
      text: r.contextText,
      citedText: r.text,
      sectionTitle: r.sectionTitle,
      pageStart: r.pageStart,
    }))

  const draftBlocks = draftResults
    .filter(r => !r.citable)
    .map(r => ({
      id: r.id,
      content: r.content,
      parentHeading: r.parentHeading,
    }))

  const userPrompt = buildChatPrompt(message, evidence, draftBlocks)

  // 5. Call the model
  const response = await generateText({
    model: openrouter(MODEL),
    maxOutputTokens: 4096,
    system: CHAT_SYSTEM_PROMPT,
    prompt: userPrompt,
  })

  const rawText = response.text

  // 6. Parse and validate.
  // Models wrap JSON in a ```json fence often enough to be worth tolerating,
  // even though the system prompt forbids it — a fence is a formatting slip,
  // not a grounding failure, and rejecting it would discard a valid answer.
  let parsed
  try {
    const json = JSON.parse(stripCodeFence(rawText))
    parsed = ChatResponseSchema.parse(json)
  } catch {
    console.error('Model response failed validation:', rawText)
    return Response.json(
      { error: 'Model returned an invalid response. Please try again.' },
      { status: 500 }
    )
  }

  // 7. Validate all evidence IDs in the response actually exist in retrieved set
  const validIds = new Set(evidence.map(e => e.id))
  const allSegmentIds = parsed.segments.flatMap(s => s.evidenceIds)
  const unknownIds = allSegmentIds.filter(id => !validIds.has(id))

  if (unknownIds.length > 0) {
    console.error('Model returned unknown evidence IDs:', unknownIds)
    return Response.json(
      { error: 'Model cited sources that were not retrieved. Please try again.' },
      { status: 500 }
    )
  }

  // 8. Log to generation_runs
  await supabase.from('generation_runs').insert({
    document_id: documentId,
    user_id: user.id,
    action: 'chat',
    instruction: message,
    model: MODEL,
    prompt_tokens: response.usage.inputTokens ?? null,
    completion_tokens: response.usage.outputTokens ?? null,
    retrieved_evidence_ids: evidence.map(e => e.id),
    proposed_patch: parsed,
    accepted: null,
  })

  // 9. Return response with evidence metadata attached.
  // `text` is the citable passage — the citation card shows what the AI cited,
  // not the wider window the model read.
  return Response.json({
    segments: parsed.segments,
    evidenceSufficient: parsed.evidenceSufficient,
    note: parsed.note ?? null,
    evidence: evidence.map(e => ({
      id: e.id,
      sourceId: e.sourceId,
      text: e.citedText,
      sectionTitle: e.sectionTitle,
      pageStart: e.pageStart,
    })),
  })
}
