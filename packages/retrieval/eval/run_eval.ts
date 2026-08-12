import OpenAI from 'openai'
import { SourceHybridRetriever } from '../src/hybrid'
import type { EvidenceResult } from '../src/interface'
import questions from './questions.json'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const retriever = new SourceHybridRetriever()

const EMBEDDING_MODEL = 'text-embedding-3-small'
const TOP_K = 10

interface EvalQuestion {
  id: string
  query: string
  expectedSourceId: string
  expectedPage: number
  expectedPassageContains: string
  notes?: string
}

interface EvalResult {
  question: EvalQuestion
  hit5: boolean
  hit10: boolean
  topResult: EvidenceResult | null
}

async function embedQuery(query: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  })
  return response.data[0].embedding
}

function isHit(results: EvidenceResult[], question: EvalQuestion, k: number): boolean {
  return results.slice(0, k).some(
    r =>
      r.sourceId === question.expectedSourceId &&
      r.text.toLowerCase().includes(question.expectedPassageContains.toLowerCase())
  )
}

async function runEval(): Promise<void> {
  if ((questions as EvalQuestion[]).length === 0) {
    console.log('No questions found in questions.json. Add questions before running the eval.')
    process.exit(0)
  }

  const results: EvalResult[] = []

  for (const question of questions as EvalQuestion[]) {
    process.stdout.write(`Running ${question.id}... `)

    const queryEmbedding = await embedQuery(question.query)

    const retrieved = await retriever.retrieve({
      query: question.query,
      queryEmbedding,
      documentId: '',               // not filtering by document for source eval
      sourceIds: [question.expectedSourceId],
      topK: TOP_K,
      includeEvidence: true,
      includeDraft: false,
    })

    const hit5 = isHit(retrieved, question, 5)
    const hit10 = isHit(retrieved, question, 10)
    const topResult = retrieved[0] ?? null

    results.push({ question, hit5, hit10, topResult })

    console.log(hit5 ? '✓' : '✗')
  }

  // Summary
  const total = results.length
  const recall5 = results.filter(r => r.hit5).length
  const recall10 = results.filter(r => r.hit10).length

  console.log('\n' + '─'.repeat(50))
  console.log(`Total questions: ${total}`)
  console.log(`Recall@5:  ${recall5}/${total} (${Math.round((recall5 / total) * 100)}%)`)
  console.log(`Recall@10: ${recall10}/${total} (${Math.round((recall10 / total) * 100)}%)`)

  // Failures
  const failures = results.filter(r => !r.hit5)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      const top = f.topResult
      const topDesc = top
        ? `got: "${top.text.slice(0, 60)}..." (page ${top.pageStart}, source ${top.sourceId.slice(0, 8)})`
        : 'got: no results'
      console.log(`  [${f.question.id}] "${f.question.query}"`)
      console.log(`         expected: source ${f.question.expectedSourceId.slice(0, 8)}, page ${f.question.expectedPage}`)
      console.log(`         ${topDesc}`)
    }
  }

  console.log('─'.repeat(50))

  if (recall5 / total < 0.8) {
    console.log('\n✗ GATE FAILED: recall@5 is below 80%. Do not proceed to AI generation.')
    process.exit(1)
  } else {
    console.log('\n✓ GATE PASSED: recall@5 ≥ 80%. Safe to proceed.')
    process.exit(0)
  }
}

runEval().catch(err => {
  console.error('Eval crashed:', err)
  process.exit(1)
})
