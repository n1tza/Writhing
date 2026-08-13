import OpenAI from 'openai'

// Built on first use, not at import. A module-scope client throws during
// Next's build-time page-data collection, where the key is not in scope.
let openai: OpenAI | null = null

function client(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return openai
}

// Must match the model the Python worker uses at index time. Vectors from
// different models are not comparable, and the resulting degradation is silent.
const EMBEDDING_MODEL = 'text-embedding-3-small'

export async function embedQuery(query: string): Promise<number[]> {
  const response = await client().embeddings.create({
    model: EMBEDDING_MODEL,
    input: query,
  })
  return response.data[0].embedding
}
