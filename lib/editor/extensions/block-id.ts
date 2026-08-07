import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { v4 as uuidv4 } from "uuid";

/**
 * Node types that carry a stable `blockId`. Everything downstream — autosave,
 * retrieval, AI patches, citation bindings — addresses content by this id, so it
 * is assigned once when a node appears and never reassigned afterwards.
 */
export const BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
];

export const blockIdPluginKey = new PluginKey("blockId");

/**
 * Give every block node in `doc` a `blockId`, writing the changes into `tr`.
 *
 * Two nodes can legitimately end up sharing an id — splitting a paragraph with
 * Enter copies its attributes into both halves, and so does copy/paste. Since
 * `document_blocks.id` is a primary key, a duplicate would make one of the two
 * blocks silently overwrite the other on upsert, so the first occurrence in
 * document order keeps the id and any later twin is given a fresh one.
 *
 * Returns true if anything was assigned.
 */
function assignMissingIds(doc: ProseMirrorNode, tr: Transaction): boolean {
  const seen = new Set<string>();
  let modified = false;

  doc.descendants((node, pos) => {
    if (!BLOCK_TYPES.includes(node.type.name)) return;

    const existing: unknown = node.attrs.blockId;
    if (typeof existing === "string" && existing && !seen.has(existing)) {
      seen.add(existing);
      return;
    }

    const blockId = uuidv4();
    seen.add(blockId);
    // setNodeMarkup preserves node size, so positions gathered from `doc` stay
    // valid for the rest of this traversal.
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId });
    modified = true;
  });

  return modified;
}

export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes) => {
              if (!attributes.blockId) return {};
              return { "data-block-id": attributes.blockId };
            },
          },
        },
      },
    ];
  },

  // Content passed to the editor up front (a reloaded document, say) never goes
  // through a transaction, so stamp it once the view exists.
  onCreate() {
    const { view } = this.editor;
    const tr = view.state.tr;
    if (assignMissingIds(view.state.doc, tr)) {
      view.dispatch(tr.setMeta("addToHistory", false));
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdPluginKey,
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }

          const tr = newState.tr;
          if (!assignMissingIds(newState.doc, tr)) return null;
          return tr.setMeta("addToHistory", false);
        },
      }),
    ];
  },
});
