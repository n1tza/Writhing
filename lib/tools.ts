import { z } from "zod";

export const editDocumentSchema = z.object({
  find: z
    .string()
    .describe(
      "The exact snippet of existing document text to replace. Must match the document verbatim.",
    ),
  replace: z
    .string()
    .describe("The new text that should take the place of the found snippet."),
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
  reason: z.string().describe("A short explanation of what is being added."),
});

export const rewriteDocumentSchema = z.object({
  content: z
    .string()
    .describe(
      "The full new contents of the document. Use blank lines to separate paragraphs.",
    ),
  reason: z.string().describe("A short explanation of the rewrite."),
});

export type EditDocumentInput = z.infer<typeof editDocumentSchema>;
export type InsertTextInput = z.infer<typeof insertTextSchema>;
export type RewriteDocumentInput = z.infer<typeof rewriteDocumentSchema>;

export const editorTools = {
  editDocument: {
    description:
      "Replace a specific snippet of the document with new text. Use for targeted edits like rewording a sentence or fixing a phrase. The 'find' text must exactly match text currently in the document.",
    inputSchema: editDocumentSchema,
  },
  insertText: {
    description:
      "Insert new text into the document, either at the user's cursor or appended to the end. Use when adding new content rather than changing existing text.",
    inputSchema: insertTextSchema,
  },
  rewriteDocument: {
    description:
      "Replace the entire document with new content. Use only for large-scale rewrites or when the user explicitly asks to rewrite the whole document.",
    inputSchema: rewriteDocumentSchema,
  },
} as const;

export type EditorToolName = keyof typeof editorTools;
