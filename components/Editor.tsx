"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  TextStyle,
  Color,
  FontFamily,
  FontSize,
} from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import {
  DOMParser as PMDOMParser,
  type Fragment,
  type Node as ProseMirrorNode,
  type Schema,
} from "@tiptap/pm/model";
import { marked } from "marked";
import { DiffDeleteMark, DiffInsertMark } from "@/lib/diffExtensions";
import EditorToolbar from "@/components/EditorToolbar";
import {
  createDebouncedSaver,
  loadDocument,
  saveDocument,
} from "@/lib/storage";
import type {
  EditDocumentInput,
  Formatting,
  InsertTextInput,
  RewriteDocumentInput,
} from "@/lib/tools";

export type EditKind = "editDocument" | "insertText" | "rewriteDocument";

export interface EditorApi {
  getPlainText: () => string;
  /** Current document as HTML, so the assistant can see the formatting in use. */
  getHtml: () => string;
  getSelectionText: () => string;
  /** Show a proposed edit inline as a diff. Returns false if it couldn't be shown. */
  proposeEdit: (id: string, kind: EditKind, input: unknown) => boolean;
  acceptDiff: (id: string) => void;
  rejectDiff: (id: string) => void;
}

export interface DiffHandlers {
  accept: (id: string) => void;
  reject: (id: string) => void;
}

interface Pill {
  id: string;
  top: number;
}

function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, breaks: true });
}

function inlineMarkdownToHtml(markdown: string): string {
  return marked.parseInline(markdown, { async: false, breaks: true });
}

/** Parse block-level HTML (paragraphs, headings, lists, ...) into PM nodes. */
function parseBlockHtml(schema: Schema, html: string): Fragment {
  const dom = new window.DOMParser().parseFromString(html, "text/html");
  return PMDOMParser.fromSchema(schema).parse(dom.body).content;
}

/** Parse inline HTML (bold, italic, ...) into inline PM nodes, no block wrapper. */
function parseInlineHtml(schema: Schema, html: string): Fragment {
  const dom = new window.DOMParser().parseFromString(
    `<span>${html}</span>`,
    "text/html",
  );
  const span = dom.body.firstElementChild ?? dom.body;
  return PMDOMParser.fromSchema(schema)
    .parseSlice(span, { preserveWhitespace: true })
    .content;
}

function gatherDiffEnds(doc: ProseMirrorNode): Map<string, number> {
  const ends = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (
        (mark.type.name === "diffInsert" || mark.type.name === "diffDelete") &&
        typeof mark.attrs.diffId === "string"
      ) {
        const id = mark.attrs.diffId as string;
        const end = pos + node.nodeSize;
        if ((ends.get(id) ?? 0) < end) ends.set(id, end);
      }
    }
  });
  return ends;
}

function normalizeFontSize(size: string): string {
  const trimmed = size.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

/** Build a textStyle mark attribute object from the model's formatting field. */
function formattingAttrs(
  formatting?: Formatting,
): Record<string, string> | null {
  if (!formatting) return null;
  const attrs: Record<string, string> = {};
  if (formatting.fontFamily) attrs.fontFamily = formatting.fontFamily;
  if (formatting.fontSize) attrs.fontSize = normalizeFontSize(formatting.fontSize);
  if (formatting.color) attrs.color = formatting.color;
  return Object.keys(attrs).length > 0 ? attrs : null;
}

export default function Editor({
  apiRef,
  diffHandlersRef,
}: {
  apiRef: MutableRefObject<EditorApi | null>;
  diffHandlersRef: MutableRefObject<DiffHandlers>;
}) {
  const debouncedSave = useRef(createDebouncedSaver(500));
  const pendingRewrites = useRef(
    new Map<
      string,
      { oldHtml: string; newHtml: string; formatting?: Formatting }
    >(),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pills, setPills] = useState<Pill[]>([]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      DiffInsertMark,
      DiffDeleteMark,
    ],
    content: loadDocument(),
    editorProps: {
      attributes: { class: "writhing-prose focus:outline-none" },
    },
    onUpdate: ({ editor }) => {
      if (gatherDiffEnds(editor.state.doc).size === 0) {
        debouncedSave.current(editor.getHTML());
      }
    },
  });

  // Recompute the floating Accept/Reject pill positions from the diff marks.
  useEffect(() => {
    if (!editor) return;

    const recompute = () => {
      const container = containerRef.current;
      if (!container) return;
      const ends = gatherDiffEnds(editor.state.doc);
      if (ends.size === 0) {
        setPills((prev) => (prev.length ? [] : prev));
        return;
      }
      const rect = container.getBoundingClientRect();
      const next: Pill[] = [];
      const docSize = editor.state.doc.content.size;
      ends.forEach((end, id) => {
        try {
          const coords = editor.view.coordsAtPos(Math.min(end, docSize));
          next.push({ id, top: coords.top - rect.top });
        } catch {
          // position not currently laid out; skip
        }
      });
      setPills(next);
    };

    const onTransaction = () => requestAnimationFrame(recompute);
    editor.on("transaction", onTransaction);
    window.addEventListener("resize", onTransaction);
    requestAnimationFrame(recompute);

    return () => {
      editor.off("transaction", onTransaction);
      window.removeEventListener("resize", onTransaction);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      apiRef.current = null;
      return;
    }

    // Length-preserving normalization so smart quotes / dashes / nbsp in the
    // document match the plain-text snippet the model copied, without breaking
    // the index -> position mapping.
    const normalize = (s: string) =>
      s
        .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
        .replace(/[\u201C\u201D\u2033]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u00A0/g, " ");

    const findRange = (rawFind: string): { from: number; to: number } | null => {
      const find = rawFind.trim();
      if (!find) return null;
      const normFind = normalize(find);

      let result: { from: number; to: number } | null = null;
      // Search each text block's full text so matches survive formatting splits
      // (e.g. a bold word) within a paragraph.
      editor.state.doc.descendants((node, pos) => {
        if (result) return false;
        if (node.isTextblock) {
          const idx = normalize(node.textContent).indexOf(normFind);
          if (idx !== -1) {
            const from = pos + 1 + idx;
            result = { from, to: from + normFind.length };
            return false;
          }
        }
        return true;
      });
      return result;
    };

    const collectRanges = (id: string, markName: string) => {
      const ranges: { from: number; to: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (
          node.isText &&
          node.marks.some(
            (m) => m.type.name === markName && m.attrs.diffId === id,
          )
        ) {
          ranges.push({ from: pos, to: pos + node.nodeSize });
        }
      });
      return ranges;
    };

    const saveClean = () => {
      if (gatherDiffEnds(editor.state.doc).size === 0) {
        saveDocument(editor.getHTML());
      }
    };

    const api: EditorApi = {
      getPlainText: () => editor.getText(),
      getHtml: () => editor.getHTML(),
      getSelectionText: () => {
        const { from, to } = editor.state.selection;
        if (from === to) return "";
        return editor.state.doc.textBetween(from, to, "\n");
      },

      proposeEdit: (id, kind, input) => {
        const { schema } = editor.state;

        // Apply font/size/color uniformly across a range as a textStyle mark,
        // so multi-paragraph insertions all share the formatting (a single
        // inline <span> cannot cross paragraph boundaries).
        const applyFormatting = (
          tr: typeof editor.state.tr,
          from: number,
          to: number,
          formatting?: Formatting,
        ) => {
          const attrs = formattingAttrs(formatting);
          if (!attrs || !schema.marks.textStyle) return;
          tr.addMark(from, to, schema.marks.textStyle.create(attrs));
        };

        const insertFragment = (
          tr: typeof editor.state.tr,
          at: number,
          frag: Fragment,
          formatting?: Formatting,
        ) => {
          if (frag.size === 0) return false;
          tr.insert(at, frag);
          applyFormatting(tr, at, at + frag.size, formatting);
          tr.addMark(
            at,
            at + frag.size,
            schema.marks.diffInsert.create({ diffId: id }),
          );
          return true;
        };

        if (kind === "editDocument") {
          const { find, replace, formatting } = input as EditDocumentInput;
          const range = findRange(find);
          if (!range) return false;
          const tr = editor.state.tr;
          tr.addMark(
            range.from,
            range.to,
            schema.marks.diffDelete.create({ diffId: id }),
          );
          if (replace.trim()) {
            insertFragment(
              tr,
              range.to,
              parseInlineHtml(schema, inlineMarkdownToHtml(replace)),
              formatting,
            );
          }
          editor.view.dispatch(tr);
          return true;
        }

        if (kind === "insertText") {
          const { text, position, formatting } = input as InsertTextInput;
          if (!text.trim()) return false;
          const tr = editor.state.tr;
          const ok =
            position === "cursor"
              ? insertFragment(
                  tr,
                  editor.state.selection.from,
                  parseInlineHtml(schema, inlineMarkdownToHtml(text)),
                  formatting,
                )
              : insertFragment(
                  tr,
                  editor.state.doc.content.size,
                  parseBlockHtml(schema, markdownToHtml(text)),
                  formatting,
                );
          if (!ok) return false;
          editor.view.dispatch(tr);
          return true;
        }

        if (kind === "rewriteDocument") {
          const { content, formatting } = input as RewriteDocumentInput;
          if (!content.trim()) return false;
          const newHtml = markdownToHtml(content);
          pendingRewrites.current.set(id, {
            oldHtml: editor.getHTML(),
            newHtml,
            formatting,
          });
          const tr = editor.state.tr;
          tr.addMark(
            0,
            editor.state.doc.content.size,
            schema.marks.diffDelete.create({ diffId: id }),
          );
          const ok = insertFragment(
            tr,
            editor.state.doc.content.size,
            parseBlockHtml(schema, newHtml),
            formatting,
          );
          if (!ok) return false;
          editor.view.dispatch(tr);
          return true;
        }

        return false;
      },

      acceptDiff: (id) => {
        const rewrite = pendingRewrites.current.get(id);
        if (rewrite) {
          pendingRewrites.current.delete(id);
          editor.chain().setContent(rewrite.newHtml).focus("end").run();
          const attrs = formattingAttrs(rewrite.formatting);
          if (attrs && editor.state.schema.marks.textStyle) {
            const tr = editor.state.tr;
            tr.addMark(
              0,
              editor.state.doc.content.size,
              editor.state.schema.marks.textStyle.create(attrs),
            );
            editor.view.dispatch(tr);
          }
          saveClean();
          return;
        }

        const tr = editor.state.tr;
        for (const range of collectRanges(id, "diffInsert")) {
          tr.removeMark(
            range.from,
            range.to,
            editor.state.schema.marks.diffInsert,
          );
        }
        collectRanges(id, "diffDelete")
          .sort((a, b) => b.from - a.from)
          .forEach((range) => tr.delete(range.from, range.to));
        editor.view.dispatch(tr);
        saveClean();
      },

      rejectDiff: (id) => {
        const rewrite = pendingRewrites.current.get(id);
        if (rewrite) {
          pendingRewrites.current.delete(id);
          editor.chain().setContent(rewrite.oldHtml).focus("end").run();
          saveClean();
          return;
        }

        const tr = editor.state.tr;
        for (const range of collectRanges(id, "diffDelete")) {
          tr.removeMark(
            range.from,
            range.to,
            editor.state.schema.marks.diffDelete,
          );
        }
        collectRanges(id, "diffInsert")
          .sort((a, b) => b.from - a.from)
          .forEach((range) => tr.delete(range.from, range.to));
        editor.view.dispatch(tr);
        saveClean();
      },
    };

    apiRef.current = api;
    return () => {
      apiRef.current = null;
    };
  }, [editor, apiRef]);

  return (
    <>
      {editor && <EditorToolbar editor={editor} />}
      <div
        ref={containerRef}
        className="relative mx-auto w-full max-w-3xl px-10 py-16"
      >
        <EditorContent editor={editor} />

      {pills.map((pill) => (
        <div
          key={pill.id}
          style={{ top: pill.top }}
          className="absolute right-0 z-10 flex -translate-y-1/2 translate-x-[calc(100%+8px)] items-center gap-1 rounded-full border border-zinc-200 bg-white p-0.5 shadow-md dark:border-zinc-700 dark:bg-zinc-800"
        >
          <button
            type="button"
            title="Accept edit"
            onMouseDown={(e) => {
              e.preventDefault();
              diffHandlersRef.current.accept(pill.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-green-600 transition-colors hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/40"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 10l4 4 8-8" />
            </svg>
          </button>
          <button
            type="button"
            title="Reject edit"
            onMouseDown={(e) => {
              e.preventDefault();
              diffHandlersRef.current.reject(pill.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-red-500 transition-colors hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
      ))}
      </div>
    </>
  );
}
