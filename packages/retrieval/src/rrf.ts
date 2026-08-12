const K = 60

// Only `id` is read. The index signature this originally carried made the type
// unsatisfiable by EvidenceResult and DraftResult — TypeScript does not give
// interfaces an implicit index signature — so tsc rejected both retrievers.
interface RankedItem {
  id: string
}

export function reciprocalRankFusion(
  lists: RankedItem[][],
  topK: number
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>()

  for (const list of lists) {
    list.forEach((item, index) => {
      const rank = index + 1   // 1-indexed
      const contribution = 1 / (K + rank)
      scores.set(item.id, (scores.get(item.id) ?? 0) + contribution)
    })
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
