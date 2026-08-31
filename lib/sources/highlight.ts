/**
 * Locating a stored passage inside a rendered PDF page.
 *
 * The two strings never match byte for byte. Chunk text comes from Docling
 * (which OCR'd some sources and collapses runs of whitespace differently),
 * while the page's text layer comes from the PDF's own embedded text — so the
 * same sentence differs in whitespace and in typographic punctuation. Measured
 * against the two indexed sources, raw matching found 6/6 chunks in one and
 * 3/6 in the other; the misses were quotes and dashes, not position.
 */

/** Length-preserving, so an index into the normalised string maps 1:1 back. */
function normalizeChar(char: string): string {
  if (/\s/.test(char)) return " ";
  switch (char) {
    case "‘":
    case "’":
    case "‛":
    case "′":
      return "'";
    case "“":
    case "”":
    case "″":
      return '"';
    case "–":
    case "—":
    case "−":
      return "-";
    case " ":
      return " ";
    case "ﬁ":
      return "f"; // ligatures collapse to their first letter; length is what matters
    case "ﬂ":
      return "f";
    default:
      return char.toLowerCase();
  }
}

/**
 * Collapse whitespace runs while keeping a map from each collapsed index back
 * to the source index, so a match found in the collapsed text can be resolved
 * to real positions.
 */
function collapse(source: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let inWhitespace = false;

  for (let i = 0; i < source.length; i++) {
    const char = normalizeChar(source[i]);
    if (char === " ") {
      if (inWhitespace) continue;
      inWhitespace = true;
    } else {
      inWhitespace = false;
    }
    text += char;
    map.push(i);
  }
  return { text, map };
}

export interface PassageRange {
  start: number;
  end: number;
}

/**
 * Find `passage` inside `pageText`, tolerating whitespace and punctuation
 * differences. Returns indices into `pageText`, or null if it isn't there.
 *
 * Falls back to a shorter prefix of the passage: a chunk can span a page break
 * or pick up a header the text layer places elsewhere, and matching its opening
 * sentence still puts the reader in the right place.
 */
export function findPassage(
  pageText: string,
  passage: string,
): PassageRange | null {
  const haystack = collapse(pageText);
  const needleFull = collapse(passage).text.trim();
  if (!needleFull) return null;

  for (const length of [needleFull.length, 240, 120, 60]) {
    if (length > needleFull.length) continue;
    const needle = needleFull.slice(0, length).trim();
    if (needle.length < 20) break;

    const at = haystack.text.indexOf(needle);
    if (at === -1) continue;

    const start = haystack.map[at];
    const end = haystack.map[Math.min(at + needle.length - 1, haystack.map.length - 1)];
    return { start, end: end + 1 };
  }

  return null;
}
