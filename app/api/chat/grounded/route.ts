import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { retrieveContext } from '@/lib/ai/evidence'
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

  // Retrieval: query building, embedding, both retrievers, and source labels.
  // Shared with Agent mode, so both are grounded in the same passages.
  const { evidence, draftBlocks } = await retrieveContext({
    supabase,
    message,
    selectedText,
    documentId,
    sourceIds,
  })

  // contextText, not text: the model reads the passage plus its neighbours so
  // it can resolve references the passage opens with ("Such societies need..."),
  // while the citation still points at the exact matched paragraph.
  const userPrompt = buildChatPrompt(
    message,
    evidence.map(e => ({ ...e, text: e.contextText })),
    draftBlocks,
  )

  // Call the model
  const response = await generateText({
    model: openrouter(MODEL),
    maxOutputTokens: 4096,
    system: CHAT_SYSTEM_PROMPT,
    prompt: userPrompt,
  })

  const rawText = response.text

  // Parse and validate.
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

  // Validate all evidence IDs in the response actually exist in retrieved set
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

  // Log to generation_runs
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

  // Return response with evidence metadata attached.
  // `text` is the citable passage — the citation card shows what the AI cited,
  // not the wider window the model read.
  return Response.json({
    segments: parsed.segments,
    evidenceSufficient: parsed.evidenceSufficient,
    note: parsed.note ?? null,
    evidence: evidence.map(e => ({
      id: e.id,
      sourceId: e.sourceId,
      sourceLabel: e.sourceLabel,
      text: e.text,
      sectionTitle: e.sectionTitle,
      pageStart: e.pageStart,
    })),
  })
}
