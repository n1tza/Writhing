import { createClient } from '@supabase/supabase-js'
import { reciprocalRankFusion } from './rrf'
import type { Retriever, RetrievalRequest, DraftResult } from './interface'

/** Column shape returned by both legs; supabase-js types rpc() data as any. */
interface DraftRow {
  id: string
  document_id: string
  block_type: string
  content: string
  parent_heading: string | null
  position: number
}

export class DraftBlockRetriever implements Retriever {
  private supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  async retrieve(input: RetrievalRequest): Promise<DraftResult[]> {
    const { query, queryEmbedding, documentId, topK } = input

    const [vectorResults, ftsResults] = await Promise.all([
      this.vectorSearch(queryEmbedding, documentId, 20),
      this.ftsSearch(query, documentId, 20),
    ])

    const merged = reciprocalRankFusion([vectorResults, ftsResults], topK)

    const allResults = new Map<string, DraftResult>()
    for (const r of [...vectorResults, ...ftsResults]) {
      allResults.set(r.id, r)
    }

    return merged
      .map(({ id, score }) => {
        const item = allResults.get(id)
        if (!item) return null
        return { ...item, score }
      })
      .filter((r): r is DraftResult => r !== null)
  }

  private async vectorSearch(
    embedding: number[],
    documentId: string,
    limit: number
  ): Promise<DraftResult[]> {
    const { data, error } = await this.supabase.rpc('match_document_blocks', {
      query_embedding: embedding,
      p_document_id: documentId,
      match_count: limit,
    })

    if (error) throw new Error(`Draft vector search failed: ${error.message}`)

    return (data ?? []).map((row: DraftRow, index: number) => ({
      id: row.id,
      documentId: row.document_id,
      blockType: row.block_type,
      content: row.content,
      parentHeading: row.parent_heading,
      position: row.position,
      score: 1 / (60 + index + 1),
      citable: false as const,
    }))
  }

  private async ftsSearch(
    query: string,
    documentId: string,
    limit: number
  ): Promise<DraftResult[]> {
    const { data, error } = await this.supabase
      .from('document_blocks')
      .select('id, document_id, block_type, content, parent_heading, position')
      .textSearch('content', query, { type: 'plain', config: 'english' })
      .eq('document_id', documentId)
      .limit(limit)

    if (error) throw new Error(`Draft FTS search failed: ${error.message}`)

    return (data ?? []).map((row: DraftRow, index: number) => ({
      id: row.id,
      documentId: row.document_id,
      blockType: row.block_type,
      content: row.content,
      parentHeading: row.parent_heading,
      position: row.position,
      score: 1 / (60 + index + 1),
      citable: false as const,
    }))
  }
}
