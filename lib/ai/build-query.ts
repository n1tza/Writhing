export function buildRetrievalQuery(
  userMessage: string,
  selectedText: string | null
): string {
  // The selected text is the primary signal — it contains the actual subject matter.
  // The user message provides intent but often contains verbs like "rewrite" or
  // "find evidence" that add noise to the retrieval query. Strip them.
  if (selectedText && selectedText.trim().length > 20) {
    // Use the first 300 chars of selected text + key nouns from the message
    const trimmedSelection = selectedText.trim().slice(0, 300)
    const messageNouns = extractContentWords(userMessage)
    return `${trimmedSelection} ${messageNouns}`.trim()
  }

  // No selection — use the message directly but strip common instruction verbs
  return stripInstructionVerbs(userMessage)
}

const INSTRUCTION_VERBS = [
  'rewrite', 'improve', 'find', 'show', 'give', 'make', 'help',
  'continue', 'expand', 'summarise', 'summarize', 'explain', 'suggest',
]

function stripInstructionVerbs(text: string): string {
  const words = text.split(' ')
  return words
    .filter(w => !INSTRUCTION_VERBS.includes(w.toLowerCase()))
    .join(' ')
    .trim()
}

function extractContentWords(text: string): string {
  return stripInstructionVerbs(text)
}
