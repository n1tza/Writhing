import type { Editor } from "@tiptap/core";

/**
 * Types that become a stored block.
 *
 * Deliberately narrower than BLOCK_TYPES: lists nest as
 * bulletList > listItem > paragraph, so extracting the containers too would
 * emit the same bullet text three times, triple-counting it in embeddings and
 * inflating every later `position`. List containers still carry a blockId — an
 * AI patch may want to target a whole list — they just aren't stored
 * themselves, and the leaf paragraph inside each item represents the bullet.
 *
 * blockquote nests the same way but is kept, because quoted source material is
 * exactly what citation binding needs to find. The traversal below stores it
 * and then skips its subtree, so its paragraphs aren't emitted a second time.
 */
const EXTRACTABLE_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
];

export interface DocumentBlock {
  /** The stable `blockId` UUID carried by the node. */
  id: string;
  documentId: string;
  blockType: string;
  /** Plain text only, no marks or HTML. */
  content: string;
  parentHeading: string | null;
  /** Index in document order, 0-based. */
  position: number;
}

/**
 * Flatten the editor document into the row shape stored in `document_blocks`.
 *
 * Blocks keep the id assigned by the BlockId extension, so a block's row
 * survives edits, reorders and reloads.
 */
export function extractBlocks(
  editor: Editor,
  documentId: string,
): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  let position = 0;
  let currentHeading: string | null = null;

  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") {
      currentHeading = node.textContent;
    }

    if (!EXTRACTABLE_TYPES.includes(node.type.name)) return true;

    const blockId: unknown = node.attrs.blockId;
    // Nodes without an id yet (mid-transaction) and empty blocks carry nothing
    // worth retrieving, so they are skipped rather than stored.
    if (typeof blockId !== "string" || !blockId) return true;
    if (!node.textContent.trim()) return false;

    blocks.push({
      id: blockId,
      documentId,
      blockType: node.type.name,
      // Block children are joined with a blank line so a multi-paragraph quote
      // doesn't run its sentences together.
      content: node.textBetween(0, node.content.size, "\n\n"),
      parentHeading: node.type.name === "heading" ? null : currentHeading,
      position,
    });

    position++;
    // Nothing inside a stored block is stored again.
    return false;
  });

  return blocks;
}
