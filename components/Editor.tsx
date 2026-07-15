"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
import { PaginationPlus } from "tiptap-pagination-plus";
import {
  DOMParser as PMDOMParser,
  type Fragment,
  type Node as ProseMirrorNode,
  type Schema,
} from "@tiptap/pm/model";
import { marked } from "marked";
import { DiffDeleteMark, DiffInsertMark } from "@/lib/diffExtensions";
import { IndentExtension } from "@/lib/indentExtension";
import EditorToolbar from "@/components/EditorToolbar";
import Ruler from "@/components/Ruler";
import {
  createDebouncedSaver,
  loadDocument,
  saveDocument,
} from "@/lib/storage";
import {
  DEFAULT_PAGE_SETTINGS,
  DOC_CANVAS,
  inToPx,
  LETTER_PAGE,
  loadPageSettings,
  savePageSettings,
  type PageSettings,
} from "@/lib/pageSettings";
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
  refine: (id: string) => void;
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
  // Bare numbers are treated as points, matching the toolbar and export.
  return /^\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}pt` : trimmed;
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
  const [pageSettings, setPageSettings] =
    useState<PageSettings>(DEFAULT_PAGE_SETTINGS);

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
      IndentExtension,
      PaginationPlus.configure({
        pageWidth: LETTER_PAGE.width,
        pageHeight: LETTER_PAGE.height,
        marginTop: inToPx(DEFAULT_PAGE_SETTINGS.margins.top),
        marginBottom: inToPx(DEFAULT_PAGE_SETTINGS.margins.bottom),
        marginLeft: inToPx(DEFAULT_PAGE_SETTINGS.margins.left),
        marginRight: inToPx(DEFAULT_PAGE_SETTINGS.margins.right),
        contentMarginTop: 0,
        contentMarginBottom: 0,
        pageGap: 24,
        pageBreakBackground: DOC_CANVAS,
        pageGapBorderColor: "transparent",
        footerLeft: "",
        footerRight: "",
        headerLeft: "",
        headerRight: "",
      }),
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

  // Load persisted page settings on the client (kept out of the initial render
  // so server and first client render agree on the default layout).
  useEffect(() => {
    setPageSettings(loadPageSettings());
  }, []);

  useEffect(() => {
    savePageSettings(pageSettings);
  }, [pageSettings]);

  // Push the page size + margins into the pagination extension whenever the
  // settings change, so the on-screen page always matches the export.
  useEffect(() => {
    if (!editor) return;
    const m = pageSettings.margins;
    editor.commands.updatePageSize({
      pageWidth: LETTER_PAGE.width,
      pageHeight: LETTER_PAGE.height,
      marginTop: inToPx(m.top),
      marginBottom: inToPx(m.bottom),
      marginLeft: inToPx(m.left),
      marginRight: inToPx(m.right),
    });
  }, [editor, pageSettings]);

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

    // Collapse runs of whitespace to a single space, keeping a map from each
    // collapsed-string index back into the source character array. Lets a
    // multi-paragraph snippet match regardless of how many blank lines separate
    // paragraphs in the document vs. the snippet the model copied.
    const collapseWhitespace = (chars: string[]) => {
      let s = "";
      const map: number[] = [];
      let inWs = false;
      for (let i = 0; i < chars.length; i++) {
        if (/\s/.test(chars[i])) {
          if (!inWs) {
            s += " ";
            map.push(i);
            inWs = true;
          }
        } else {
          s += chars[i];
          map.push(i);
          inWs = false;
        }
      }
      return { s, map };
    };

    const findRange = (rawFind: string): { from: number; to: number } | null => {
      const find = rawFind.trim();
      if (!find) return null;
      const normFind = normalize(find);

      // 1) Fast path: match inside a single text block, preserving exact offsets
      // (survives formatting splits like a bold word within a paragraph).
      let result: { from: number; to: number } | null = null;
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
      if (result) return result;

      // 2) Cross-block match: flatten all text into one string with a position
      // map, so a snippet spanning multiple paragraphs can still be located.
      const flat: string[] = [];
      const posMap: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock) {
          const text = normalize(node.textContent);
          for (let i = 0; i < text.length; i++) {
            flat.push(text[i]);
            posMap.push(pos + 1 + i);
          }
          // Represent the paragraph break as a newline positioned at the block's
          // content end, so it never becomes part of an accepted range.
          flat.push("\n");
          posMap.push(pos + 1 + node.content.size);
          return false;
        }
        return true;
      });

      const hay = collapseWhitespace(flat);
      const needle = collapseWhitespace(normFind.split("")).s.trim();
      if (!needle) return null;
      const at = hay.s.indexOf(needle);
      if (at === -1) return null;

      const startFlat = hay.map[at];
      const endFlat = hay.map[at + needle.length - 1];
      const from = posMap[startFlat];
      const to = posMap[endFlat];
      if (typeof from !== "number" || typeof to !== "number") return null;
      return { from, to: to + 1 };
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

  const docStyle = {
    "--doc-line-height": String(pageSettings.lineHeight),
    "--doc-para-spacing": `${pageSettings.paragraphSpacing}pt`,
  } as CSSProperties;

  return (
    <>
      {editor && (
        <EditorToolbar
          editor={editor}
          pageSettings={pageSettings}
          setPageSettings={setPageSettings}
        />
      )}
      {editor && (
        <Ruler
          editor={editor}
          margins={pageSettings.margins}
          setPageSettings={setPageSettings}
        />
      )}
      <div className="flex min-h-full justify-center px-6 py-10">
        <div ref={containerRef} className="relative w-fit" style={docStyle}>
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
            title="Refine edit"
            onMouseDown={(e) => {
              e.preventDefault();
              diffHandlersRef.current.refine(pill.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-blue-500 transition-colors hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/40"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 16l3.5-.8L15 7.7 12.3 5 4.8 12.5 4 16zM11.8 5.5l2.7 2.7" />
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
      </div>
    </>
  );
}
