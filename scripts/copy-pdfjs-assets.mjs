// pdf.js needs the standard font files at runtime for PDFs that reference the
// 14 standard fonts without embedding them — without these the page renders
// with fallback glyphs. Copied from node_modules rather than committed, so the
// assets can never drift from the installed pdfjs-dist version.
import { cp, mkdir } from "node:fs/promises";

const from = "node_modules/pdfjs-dist/standard_fonts";
const to = "public/pdfjs/standard_fonts";

await mkdir("public/pdfjs", { recursive: true });
await cp(from, to, { recursive: true });
console.log(`[pdfjs] copied standard fonts -> ${to}`);
