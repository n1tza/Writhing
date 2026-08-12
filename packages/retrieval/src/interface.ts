export interface EvidenceResult {
  id: string
  sourceId: string
  text: string
  pageStart: number | null
  pageEnd: number | null
  sectionTitle: string | null
  sectionPath: string[]
  /**
   * The passage plus its neighbouring chunks, for the model to read.
   *
   * Retrieve small, read big, cite small: `text` stays the citable unit that a
   * citation binding and a page link point at, while this carries enough
   * surrounding context to resolve references the passage opens with ("Such
   * societies need...", "This distinction..."). Falls back to `text` when the
   * source predates chunk_index or the section holds a single chunk.
   */
  contextText: string
  score: number
  citable: true
}

export interface DraftResult {
  id: string
  documentId: string
  blockType: string
  content: string
  parentHeading: string | null
  position: number
  score: number
  citable: false
}

export type RetrievalResult = EvidenceResult | DraftResult

export interface RetrievalRequest {
  query: string
  queryEmbedding: number[]       // caller embeds the query; retriever never calls the embedding API
  documentId: string
  sourceIds?: string[]           // if provided, restrict to these sources only
  topK: number
  includeEvidence: boolean
  includeDraft: boolean
  /** Chunks of context to include either side of each hit. 0 disables. */
  contextRadius?: number
}

export interface Retriever {
  retrieve(input: RetrievalRequest): Promise<RetrievalResult[]>
}
