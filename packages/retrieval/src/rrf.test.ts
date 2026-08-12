import { expect, test } from 'vitest'
import { reciprocalRankFusion } from './rrf'

test('single list returns items in order', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const result = reciprocalRankFusion([list], 3)
  expect(result[0].id).toBe('a')
  expect(result[1].id).toBe('b')
  expect(result[2].id).toBe('c')
})

test('item appearing in both lists scores higher than item in one list', () => {
  const list1 = [{ id: 'a' }, { id: 'b' }]
  const list2 = [{ id: 'a' }, { id: 'c' }]
  const result = reciprocalRankFusion([list1, list2], 3)
  // 'a' appears in both lists so should be ranked first
  expect(result[0].id).toBe('a')
})

test('item missing from a list gets no contribution from that list', () => {
  const list1 = [{ id: 'a' }, { id: 'b' }]
  const list2 = [{ id: 'c' }]
  const result = reciprocalRankFusion([list1, list2], 3)
  const scoreA = result.find(r => r.id === 'a')!.score
  const scoreC = result.find(r => r.id === 'c')!.score
  // 'a' ranked 1st in list1, 'c' ranked 1st in list2 — both get one list's contribution
  expect(scoreA).toBeCloseTo(scoreC, 5)
})

test('topK limits output length', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const result = reciprocalRankFusion([list], 2)
  expect(result.length).toBe(2)
})

test('scores are sorted descending', () => {
  const list1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const list2 = [{ id: 'b' }, { id: 'a' }, { id: 'c' }]
  const result = reciprocalRankFusion([list1, list2], 3)
  for (let i = 0; i < result.length - 1; i++) {
    expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score)
  }
})
