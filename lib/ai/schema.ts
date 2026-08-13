import { z } from 'zod'

export const SegmentSchema = z.object({
  text: z.string(),
  evidenceIds: z.array(z.string()),
  // evidenceIds must be empty array for stylistic/general claims,
  // never omitted — the model must explicitly declare when it has no evidence
})

export const ChatResponseSchema = z.object({
  segments: z.array(SegmentSchema).min(1),
  evidenceSufficient: z.boolean(),
  note: z.string().nullish(),
  // note is shown to the user when evidenceSufficient is false
})

export type ChatResponse = z.infer<typeof ChatResponseSchema>
export type Segment = z.infer<typeof SegmentSchema>
