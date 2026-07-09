import { Mark, mergeAttributes } from "@tiptap/core";

const diffIdAttribute = {
  diffId: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute("data-diff-id"),
    renderHTML: (attributes: { diffId?: string | null }) =>
      attributes.diffId ? { "data-diff-id": attributes.diffId } : {},
  },
};

// Inline styles are used (in addition to classes) so the diff colors render
// reliably in both light and dark themes regardless of the CSS pipeline. The
// translucent tinted background reads as red/green over any background while
// the text color stays inherited and legible.
const INSERT_STYLE =
  "background-color: rgba(34,197,94,0.28); border-radius: 2px; padding: 0 1px; box-decoration-break: clone; -webkit-box-decoration-break: clone;";
const DELETE_STYLE =
  "background-color: rgba(244,63,94,0.24); border-radius: 2px; padding: 0 1px; text-decoration: line-through; text-decoration-color: rgba(244,63,94,0.85); box-decoration-break: clone; -webkit-box-decoration-break: clone;";

export const DiffInsertMark = Mark.create({
  name: "diffInsert",
  inclusive: false,
  addAttributes() {
    return diffIdAttribute;
  },
  parseHTML() {
    return [{ tag: "span[data-diff-insert]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-diff-insert": "true",
        class: "diff-insert",
        style: INSERT_STYLE,
      }),
      0,
    ];
  },
});

export const DiffDeleteMark = Mark.create({
  name: "diffDelete",
  inclusive: false,
  addAttributes() {
    return diffIdAttribute;
  },
  parseHTML() {
    return [{ tag: "span[data-diff-delete]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-diff-delete": "true",
        class: "diff-delete",
        style: DELETE_STYLE,
      }),
      0,
    ];
  },
});
