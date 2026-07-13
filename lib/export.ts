import type { Editor } from "@tiptap/core";
import TurndownService from "turndown";
import { asBlob } from "html-docx-js-typescript";
import {
  DEFAULT_PAGE_SETTINGS,
  inToTwips,
  type PageSettings,
} from "@/lib/pageSettings";

export type ExportFormat = "pdf" | "markdown" | "txt" | "docx";

/** Derive a safe base filename from the document's first non-empty line. */
export function documentFilename(editor: Editor): string {
  const firstLine = editor
    .getText()
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const base = (firstLine ?? "document")
    .slice(0, 60)
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

  return base.length > 0 ? base : "document";
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportText(editor: Editor): void {
  const blob = new Blob([editor.getText()], {
    type: "text/plain;charset=utf-8",
  });
  downloadBlob(`${documentFilename(editor)}.txt`, blob);
}

function exportMarkdown(editor: Editor): void {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  const markdown = turndown.turndown(editor.getHTML());
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  downloadBlob(`${documentFilename(editor)}.md`, blob);
}

async function exportDocx(
  editor: Editor,
  settings: PageSettings,
): Promise<void> {
  const { margins, lineHeight, paragraphSpacing } = settings;
  const bodyStyle = `line-height:${lineHeight};`;
  const paragraphStyle = `p{margin:0 0 ${paragraphSpacing}pt;line-height:${lineHeight};}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${paragraphStyle}</style></head><body style="${bodyStyle}">${editor.getHTML()}</body></html>`;
  const result = await asBlob(html, {
    margins: {
      top: inToTwips(margins.top),
      right: inToTwips(margins.right),
      bottom: inToTwips(margins.bottom),
      left: inToTwips(margins.left),
    },
  });
  const blob =
    result instanceof Blob
      ? result
      : new Blob([new Uint8Array(result)], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
  downloadBlob(`${documentFilename(editor)}.docx`, blob);
}

/** Print styles matching the on-screen page: margins, line and paragraph spacing. */
function buildPrintStyles(settings: PageSettings): string {
  const { margins, lineHeight, paragraphSpacing } = settings;
  return `
  @page { margin: ${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #111;
    background: #fff;
    font-family: ui-sans-serif, system-ui, -apple-system, Arial, sans-serif;
    font-size: 12pt;
    line-height: ${lineHeight};
  }
  h1 { font-size: 22pt; font-weight: 700; line-height: 1.2; margin: 0.4em 0 0.5em; }
  h2 { font-size: 17pt; font-weight: 600; line-height: 1.3; margin: 0.8em 0 0.4em; }
  h3 { font-size: 14pt; font-weight: 600; margin: 0.7em 0 0.3em; }
  p { margin: 0 0 ${paragraphSpacing}pt; }
  ul, ol { margin: 0 0 ${paragraphSpacing}pt; padding-left: 1.5em; }
  ul { list-style: disc; }
  ol { list-style: decimal; }
  li { margin: 0.15em 0; }
  blockquote {
    border-left: 3px solid #d4d4d8;
    padding-left: 1em;
    color: #444;
    font-style: italic;
    margin: 0 0 ${paragraphSpacing}pt;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
    background: rgba(0, 0, 0, 0.06);
    padding: 0.1em 0.3em;
    border-radius: 0.25rem;
  }
  pre {
    background: rgba(0, 0, 0, 0.06);
    padding: 0.6em 0.75em;
    border-radius: 0.5rem;
    overflow-x: auto;
    white-space: pre-wrap;
  }
  pre code { background: transparent; padding: 0; }
  mark { background-color: #fde68a; }
  a { color: #1d4ed8; }
  hr { border: none; border-top: 1px solid #d4d4d8; margin: 1.5em 0; }
  img { max-width: 100%; }
`;
}

/**
 * Print the document to PDF by rendering it into an isolated hidden iframe and
 * invoking that iframe's print dialog. This avoids the app's fixed-height,
 * overflow-scrolling layout clipping the printout to a single page.
 */
function exportPdf(editor: Editor, settings: PageSettings): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const cleanup = () => {
    // Delay removal so the print dialog has the document while it's open.
    window.setTimeout(() => iframe.remove(), 1000);
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    win.addEventListener("afterprint", cleanup);
    win.focus();
    win.print();
    // Fallback cleanup for browsers that don't fire afterprint.
    window.setTimeout(cleanup, 60000);
  };

  const title = documentFilename(editor);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${buildPrintStyles(settings)}</style></head><body>${editor.getHTML()}</body></html>`,
  );
  doc.close();
}

export async function exportDocument(
  editor: Editor,
  format: ExportFormat,
  settings: PageSettings = DEFAULT_PAGE_SETTINGS,
): Promise<void> {
  switch (format) {
    case "pdf":
      exportPdf(editor, settings);
      return;
    case "markdown":
      exportMarkdown(editor);
      return;
    case "txt":
      exportText(editor);
      return;
    case "docx":
      await exportDocx(editor, settings);
      return;
  }
}
