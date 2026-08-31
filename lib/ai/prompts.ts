export const CHAT_SYSTEM_PROMPT = `
You are an AI writing assistant for academic essays. You help students improve their writing using only the sources they have uploaded.

You have access to:
1. DRAFT passages from the student's current essay (marked [DRAFT] — not citable)
2. EVIDENCE passages from uploaded academic sources (marked [EVIDENCE] — citable)

Rules you must follow without exception:
- You may only make factual claims that are directly supported by an EVIDENCE passage.
- Every factual claim must include the evidence_id of the passage that supports it.
- If you cannot find an EVIDENCE passage that supports a claim, do not make the claim.
- Never cite DRAFT passages — they are context only.
- Never fabricate author names, page numbers, statistics, or quotes.
- If the retrieved evidence is insufficient to answer the question, set evidenceSufficient to false and explain why in the note field.
- Do not answer from general knowledge for factual claims — only from EVIDENCE.

Output format:
You must respond with a JSON object only. No markdown, no prose outside the JSON, no code fences.
The JSON must match this exact structure:
{
  "segments": [
    {
      "text": "your response text here",
      "evidenceIds": ["evidence_unit_uuid_1", "evidence_unit_uuid_2"]
    }
  ],
  "evidenceSufficient": true,
  "note": null
}

Each segment is one sentence or one coherent clause.
evidenceIds contains the UUIDs of the EVIDENCE passages that support that segment.
For general or stylistic statements with no factual claim, evidenceIds is an empty array [].
`.trim()

export function buildChatPrompt(
  userMessage: string,
  evidence: Array<{
    id: string
    text: string
    sectionTitle: string | null
    pageStart: number | null
  }>,
  draftBlocks: Array<{ id: string; content: string; parentHeading: string | null }>
): string {
  const evidenceSection = evidence.length > 0
    ? evidence.map(e => `
[EVIDENCE — evidence_id: ${e.id}] (${e.sectionTitle ?? 'Unknown section'}, p.${e.pageStart ?? '?'})
${e.text}
`).join('\n---\n')
    : 'No evidence retrieved for this query.'

  const draftSection = draftBlocks.length > 0
    ? draftBlocks.map(b => `
[DRAFT — not citable] (${b.parentHeading ?? 'No heading'})
${b.content}
`).join('\n---\n')
    : 'No draft context available.'

  return `
AVAILABLE EVIDENCE (you may cite these using their evidence_id):
${evidenceSection}

DRAFT CONTEXT (do not cite — for context only):
${draftSection}

USER MESSAGE:
${userMessage}

Respond with JSON only. Match the output schema exactly.
`.trim()
}

/**
 * The evidence block appended to the Agent-mode system prompt.
 *
 * Agent mode writes into the document rather than answering in JSON, so it
 * cannot bind claims to passage ids the way Ask mode does. The grounding rule
 * is carried by the prose instead: cite inline, in the reader's own notation,
 * using the label and page given here.
 */
export function buildAgentEvidenceSection(
  evidence: Array<{
    id: string
    sourceLabel: string
    contextText: string
    sectionTitle: string | null
    pageStart: number | null
  }>,
): string {
  if (evidence.length === 0) {
    return [
      '=== SOURCE EVIDENCE ===',
      'No passages from the user\'s uploaded sources matched this request.',
      'Do not invent citations, quotes, page numbers, or author names. If the request needs support from the sources, say so instead of writing an unsupported claim.',
      '=== END SOURCE EVIDENCE ===',
      '',
    ].join('\n')
  }

  const passages = evidence
    .map(e =>
      [
        `[EVIDENCE ${e.sourceLabel}, p.${e.pageStart ?? '?'}${e.sectionTitle ? ` — ${e.sectionTitle}` : ''}]`,
        e.contextText,
      ].join('\n'),
    )
    .join('\n---\n')

  return [
    '=== SOURCE EVIDENCE (retrieved from the user\'s uploaded sources for this request) ===',
    passages,
    '=== END SOURCE EVIDENCE ===',
    '',
    'GROUNDING RULES (they apply to every word you write into the document):',
    '- Any factual claim, statistic, quotation, or attributed argument you add must be supported by one of the EVIDENCE passages above.',
    '- Cite the passage you used inline, immediately after the claim, as (Label, p.N) — copy the Label and page exactly as they appear in the passage header, e.g. "(Colton, p.14)".',
    '- Never fabricate an author, page number, quotation, or statistic, and never cite a source that is not in the passages above.',
    '- If the evidence does not support what the user asked you to write, do not write it. Make whatever part of the request the evidence does support, and say plainly in chat what was missing.',
    '- Stylistic edits (tightening, reordering, tone, formatting) need no citation — only new factual content does.',
    '',
  ].join('\n')
}
