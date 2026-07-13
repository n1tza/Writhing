import { z } from "zod";

export const formattingSchema = z
  .object({
    fontFamily: z
      .string()
      .optional()
      .describe(
        "CSS font-family applied to ALL of this text, e.g. \"'Times New Roman', Times, serif\" or \"Arial, sans-serif\". Copy the value verbatim from a comparable element in the document's HTML.",
      ),
    fontSize: z
      .string()
      .optional()
      .describe('CSS font size applied to ALL of this text, in points, e.g. "12pt" or "18pt".'),
    color: z
      .string()
      .optional()
      .describe('CSS text color applied to ALL of this text, e.g. "#f87171".'),
  })
  .describe(
    "Optional formatting applied uniformly to EVERY paragraph of the text this tool inserts or replaces, so multi-paragraph content keeps a consistent font, size, and color. Prefer this over inline <span> tags when the whole insertion shares one style. Match the values used by comparable text in the DOCUMENT HTML.",
  );

export const editDocumentSchema = z.object({
  find: z
    .string()
    .describe(
      "The exact snippet of existing document text to replace. Must match the document verbatim.",
    ),
  replace: z
    .string()
    .describe("The new text that should take the place of the found snippet."),
  formatting: formattingSchema.optional(),
  reason: z
    .string()
    .describe("A short explanation of why this edit improves the document."),
});

export const insertTextSchema = z.object({
  text: z.string().describe("The text to add to the document."),
  position: z
    .enum(["end", "cursor"])
    .describe(
      "Where to insert the text: 'cursor' inserts at the current selection, 'end' appends to the document.",
    ),
  formatting: formattingSchema.optional(),
  reason: z.string().describe("A short explanation of what is being added."),
});

export const rewriteDocumentSchema = z.object({
  content: z
    .string()
    .describe(
      "The full new contents of the document. Use blank lines to separate paragraphs.",
    ),
  formatting: formattingSchema.optional(),
  reason: z.string().describe("A short explanation of the rewrite."),
});

export const planTasksSchema = z.object({
  tasks: z
    .array(
      z
        .string()
        .describe(
          "One discrete, action-oriented task, e.g. 'Rename the Chapter 1 heading to its real title'.",
        ),
    )
    .min(2)
    .describe(
      "Ordered list of 2 or more tasks. Put dependent tasks (e.g. coloring a new title) AFTER the tasks they depend on.",
    ),
});

export type Formatting = z.infer<typeof formattingSchema>;
export type EditDocumentInput = z.infer<typeof editDocumentSchema>;
export type InsertTextInput = z.infer<typeof insertTextSchema>;
export type RewriteDocumentInput = z.infer<typeof rewriteDocumentSchema>;
export type PlanTasksInput = z.infer<typeof planTasksSchema>;

export const editorTools = {
  editDocument: {
    description:
      "Replace a specific snippet of the document with new text. Use for targeted edits like rewording a sentence, fixing a phrase, or applying formatting (e.g. making a word bold). The 'find' text must exactly match text currently in the document. The 'replace' value may use inline Markdown (**bold**, *italic*, ~~strikethrough~~, `code`). To match the document's font, size, or color, set the 'formatting' field (applies to the whole replacement, including multiple paragraphs). For styling only PART of the text, you may also use inline HTML: <span style=\"...\">, <mark style=\"background-color: ...\">.",
    inputSchema: editDocumentSchema,
  },
  insertText: {
    description:
      "Insert new text into the document, either at the user's cursor or appended to the end. Use when adding new content rather than changing existing text. The 'text' may use Markdown for structure (headings #, ##; bullet lists -; numbered lists 1.; > blockquotes; **bold**; *italic*). To match the fonts/sizes/colors used elsewhere in the document, set the 'formatting' field — it is applied uniformly to EVERY paragraph you insert (use this instead of a single <span>, which cannot span multiple paragraphs). For partial inline styling, inline <span style=\"...\"> is still allowed.",
    inputSchema: insertTextSchema,
  },
  rewriteDocument: {
    description:
      "Replace the entire document with new content. Use only for large-scale rewrites or when the user explicitly asks to rewrite the whole document. The 'content' may use Markdown for structure. Set the 'formatting' field to apply a consistent font/size/color across the whole document; use inline <span style=\"...\"> / <mark> only for localized style differences.",
    inputSchema: rewriteDocumentSchema,
  },
  planTasks: {
    description:
      "Break a complex or multi-part request into an ordered list of discrete tasks, so you can complete them one at a time. Call this FIRST and ALONE (do not make any edits in the same turn) whenever a request has multiple steps, or when later steps depend on earlier ones (e.g. 'rename the chapter titles, then color the new titles blue' — the coloring depends on the rename being applied first). Order tasks so dependent steps come after what they rely on. After you call this, you will be prompted to complete each task one at a time. Do NOT call this for a single, simple edit.",
    inputSchema: planTasksSchema,
  },
} as const;

export type EditorToolName = keyof typeof editorTools;
