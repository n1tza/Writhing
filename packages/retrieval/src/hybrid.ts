import { createClient } from '@supabase/supabase-js'
import { reciprocalRankFusion } from './rrf'
import type { Retriever, RetrievalRequest, EvidenceResult } from './interface'

/** One expanded window, keyed back to the passage that matched. */
interface ContextRow {
  anchor_id: string
  context: string | null
}

/** Column shape returned by both legs; supabase-js types rpc() data as any. */
interface EvidenceRow {
  id: string
  source_id: string
  text: string
  page_start: number | null
  page_end: number | null
  section_title: string | null
  section_path: string[] | null
}

export class SourceHybridRetriever implements Retriever {
  private supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  async retrieve(input: RetrievalRequest): Promise<EvidenceResult[]> {
    const { query, queryEmbedding, sourceIds, topK, contextRadius = 1 } = input

    // Run both legs in parallel
    const [vectorResults, ftsResults] = await Promise.all([
      this.vectorSearch(queryEmbedding, sourceIds, 20),
      this.ftsSearch(query, sourceIds, 20),
    ])

    // Merge with RRF
    const merged = reciprocalRankFusion([vectorResults, ftsResults], topK)

    // Build a lookup map from both result sets
    const allResults = new Map<string, EvidenceResult>()
    for (const r of [...vectorResults, ...ftsResults]) {
      allResults.set(r.id, r)
    }

    // Merged results with RRF scores attached
    const ranked = merged
      .map(({ id, score }) => {
        const item = allResults.get(id)
        if (!item) return null
        return { ...item, score }
      })
      .filter((r): r is EvidenceResult => r !== null)

    // Widen each hit to its neighbours. Done after the merge, on the topK
    // anchors only, so it costs one query however wide the candidate pool is.
    return this.expandContext(ranked, contextRadius)
  }

  /**
   * Attach surrounding chunks to each result for the model to read.
   *
   * Only contextText changes — id, text, and pages stay pinned to the matched
   * passage, so citations keep pointing at the exact paragraph.
   */
  private async expandContext(
    results: EvidenceResult[],
    radius: number
  ): Promise<EvidenceResult[]> {
    if (radius <= 0 || results.length === 0) return results

    const { data, error } = await this.supabase.rpc('expand_evidence_context', {
      anchor_ids: results.map((r) => r.id),
      radius,
    })

    // Expansion is an enhancement, not a requirement: a source indexed before
    // chunk_index existed simply returns no window. Failing the whole retrieval
    // over it would be worse than answering from the passages alone.
    if (error) return results

    const windows = new Map<string, string>()
    for (const row of (data ?? []) as ContextRow[]) {
      if (row.context) windows.set(row.anchor_id, row.context)
    }

    return results.map((r) => ({ ...r, contextText: windows.get(r.id) ?? r.text }))
  }

  private async vectorSearch(
    embedding: number[],
    sourceIds: string[] | undefined,
    limit: number
  ): Promise<EvidenceResult[]> {
    const { data, error } = await this.supabase.rpc('match_evidence_units', {
      query_embedding: embedding,
      source_ids: sourceIds ?? null,
      match_count: limit,
    })

    if (error) throw new Error(`Vector search failed: ${error.message}`)

    return (data ?? []).map((row: EvidenceRow, index: number) => ({
      id: row.id,
      sourceId: row.source_id,
      text: row.text,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      sectionTitle: row.section_title,
      sectionPath: row.section_path ?? [],
      contextText: row.text,         // replaced by the window after merging
      score: 1 / (60 + index + 1),   // provisional score before RRF merge
      citable: true as const,
    }))
  }

  private async ftsSearch(
    query: string,
    sourceIds: string[] | undefined,
    limit: number
  ): Promise<EvidenceResult[]> {
    let q = this.supabase
      .from('evidence_units')
      .select('id, source_id, text, page_start, page_end, section_title, section_path')
      .textSearch('text', query, { type: 'plain', config: 'english' })
      .limit(limit)

    if (sourceIds && sourceIds.length > 0) {
      q = q.in('source_id', sourceIds)
    }

    const { data, error } = await q

    if (error) throw new Error(`FTS search failed: ${error.message}`)

    return (data ?? []).map((row: EvidenceRow, index: number) => ({
      id: row.id,
      sourceId: row.source_id,
      text: row.text,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      sectionTitle: row.section_title,
      sectionPath: row.section_path ?? [],
      contextText: row.text,
      score: 1 / (60 + index + 1),
      citable: true as const,
    }))
  }
}
