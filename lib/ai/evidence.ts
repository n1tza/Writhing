import type { SupabaseClient } from '@supabase/supabase-js'
import { SourceHybridRetriever, DraftBlockRetriever } from '@writhing/retrieval'
import { shortSourceLabel } from '@/lib/sources/citation'
import { buildRetrievalQuery } from './build-query'
import { embedQuery } from './embed'

/**
 * Retrieval shared by both chat modes.
 *
 * Ask mode answers *are* the evidence — segments bound to passage ids. Agent
 * mode writes into the document instead, but it needs the same passages in
 * front of it, or it drafts claims the uploaded sources do not support. Keeping
 * one retrieval path means a change to how evidence is found or labelled lands
 * in both modes at once.
 */

export interface RetrievedEvidence {
  id: string
  sourceId: string
  /** Short document name for a citation pill, e.g. an author surname. */
  sourceLabel: string
  /** The citable passage — what a citation and its page link point at. */
  text: string
  /** The passage plus its neighbours — the wider window the model reads. */
  contextText: string
  sectionTitle: string | null
  pageStart: number | null
}

export interface RetrievedDraftBlock {
  id: string
  content: string
  parentHeading: string | null
}

export interface RetrievedContext {
  evidence: RetrievedEvidence[]
  draftBlocks: RetrievedDraftBlock[]
}

export const EMPTY_CONTEXT: RetrievedContext = { evidence: [], draftBlocks: [] }

/** Sources that finished processing, and so have evidence units to retrieve. */
export async function readySourceIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('source_documents')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'ready')

  return (data ?? []).map(row => row.id as string)
}

export async function retrieveContext({
  supabase,
  message,
  selectedText,
  documentId,
  sourceIds,
  evidenceTopK = 5,
  draftTopK = 3,
}: {
  supabase: SupabaseClient
  message: string
  selectedText: string | null
  documentId: string
  sourceIds: string[]
  evidenceTopK?: number
  draftTopK?: number
}): Promise<RetrievedContext> {
  const retrievalQuery = buildRetrievalQuery(message, selectedText)
  if (retrievalQuery.trim().length === 0) return EMPTY_CONTEXT

  const embedding = await embedQuery(retrievalQuery)

  const [evidenceResults, draftResults] = await Promise.all([
    sourceIds.length > 0
      ? new SourceHybridRetriever().retrieve({
          query: retrievalQuery,
          queryEmbedding: embedding,
          documentId,
          sourceIds,
          topK: evidenceTopK,
          includeEvidence: true,
          includeDraft: false,
        })
      : Promise.resolve([]),
    draftTopK > 0
      ? new DraftBlockRetriever().retrieve({
          query: retrievalQuery,
          queryEmbedding: embedding,
          documentId,
          sourceIds: [],
          topK: draftTopK,
          includeEvidence: false,
          includeDraft: true,
        })
      : Promise.resolve([]),
  ])

  const citable = evidenceResults.filter(r => r.citable)
  const labels = await sourceLabels(
    supabase,
    [...new Set(citable.map(r => r.sourceId))],
  )

  return {
    // contextText, not text: the model reads the passage plus its neighbours so
    // it can resolve references the passage opens with ("Such societies
    // need..."), while the citation still points at the exact matched paragraph.
    evidence: citable.map(r => ({
      id: r.id,
      sourceId: r.sourceId,
      sourceLabel: labels.get(r.sourceId) ?? 'Source',
      text: r.text,
      contextText: r.contextText,
      sectionTitle: r.sectionTitle,
      pageStart: r.pageStart,
    })),
    draftBlocks: draftResults
      .filter(r => !r.citable)
      .map(r => ({
        id: r.id,
        content: r.content,
        parentHeading: r.parentHeading,
      })),
  }
}

/**
 * Short label per source, so a citation names the document rather than showing
 * a bare page number. Resolved server-side so it is correct even if the
 * client's source list is stale.
 */
async function sourceLabels(
  supabase: SupabaseClient,
  sourceIds: string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (sourceIds.length === 0) return labels

  const { data } = await supabase
    .from('source_documents')
    .select('id, filename, bibliography_items(title, authors)')
    .in('id', sourceIds)

  for (const row of data ?? []) {
    // A to-one embed (bibliography_items.source_id is unique), so PostgREST
    // returns an object here. supabase-js infers an array without generated
    // database types, which is why indexing it silently yielded undefined.
    const bib = row.bibliography_items as unknown as
      | { title: string | null; authors: string[] | null }
      | null
    labels.set(
      row.id as string,
      shortSourceLabel({
        authors: bib?.authors,
        title: bib?.title,
        filename: row.filename as string,
      }),
    )
  }

  return labels
}
