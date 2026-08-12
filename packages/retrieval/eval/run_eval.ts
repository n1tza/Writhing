/**
 * Retrieval evaluation harness.
 *
 * Embeds each question, runs the hybrid retriever, and reports whether a
 * genuinely relevant passage made the top K. Chunking and retrieval quality are
 * the levers that decide whether the AI cites the right thing, and neither is
 * visible from unit tests, so this measures them against real indexed sources.
 *
 * Usage:
 *   SOURCE_ID=<uuid> npx tsx eval/run_eval.ts [--k 5]
 *
 * Requires OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { SourceHybridRetriever } from '../src/hybrid'

interface EvalCase {
  id: string
  question: string
  expect: string[][]
}

const here = dirname(fileURLToPath(import.meta.url))
const { cases } = JSON.parse(
  readFileSync(join(here, 'questions.json'), 'utf8')
) as { cases: EvalCase[] }

const kFlag = process.argv.indexOf('--k')
const K = kFlag === -1 ? 5 : Number(process.argv[kFlag + 1])
const SOURCE_ID = process.env.SOURCE_ID
const DOCUMENT_ID = process.env.DOCUMENT_ID ?? '00000000-0000-0000-0000-000000000000'

// The model must match the one used at index time; a mismatch silently degrades
// retrieval because vectors from different models are not comparable.
const EMBEDDING_MODEL = 'text-embedding-3-small'

const openai = new OpenAI()
const retriever = new SourceHybridRetriever()

function matches(text: string, expect: string[][]): boolean {
  // OCR'd sources contain runs of whitespace inside phrases ("humanly  devised
  // constraints"), so a literal substring test would report a false miss on a
  // passage that is in fact the right one.
  const haystack = text.toLowerCase().replace(/\s+/g, ' ')
  return expect.some((group) =>
    group.every((term) => haystack.includes(term.toLowerCase().replace(/\s+/g, ' ')))
  )
}

async function main() {
  console.log(`Evaluating ${cases.length} questions at k=${K}\n`)

  let hits = 0
  const ranks: number[] = []

  for (const testCase of cases) {
    const embedding = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: testCase.question,
    })

    const results = await retriever.retrieve({
      query: testCase.question,
      queryEmbedding: embedding.data[0].embedding,
      documentId: DOCUMENT_ID,
      sourceIds: SOURCE_ID ? [SOURCE_ID] : undefined,
      topK: K,
      includeEvidence: true,
      includeDraft: false,
    })

    const hitIndex = results.findIndex((r) => matches(r.text, testCase.expect))
    const hit = hitIndex !== -1
    if (hit) {
      hits += 1
      ranks.push(hitIndex + 1)
    }

    const mark = hit ? `hit @${hitIndex + 1}` : 'MISS  '
    console.log(`${mark}  ${testCase.id}`)
    console.log(`        q: ${testCase.question}`)
    const top = results[0]
    if (top) {
      const preview = top.text.replace(/\s+/g, ' ').slice(0, 96)
      console.log(`        top (p${top.pageStart}, ${top.score.toFixed(4)}): ${preview}…`)
    } else {
      console.log('        top: no results')
    }
    console.log()
  }

  // Mean reciprocal rank over all cases; a miss contributes zero.
  const mrr = ranks.reduce((sum, rank) => sum + 1 / rank, 0) / cases.length

  console.log('─'.repeat(60))
  console.log(`recall@${K}: ${hits}/${cases.length}  (${((hits / cases.length) * 100).toFixed(0)}%)`)
  console.log(`MRR:       ${mrr.toFixed(3)}`)

  if (hits < cases.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
