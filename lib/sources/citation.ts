/**
 * The channel a citation uses to open its source at the cited page.
 *
 * The chat and the source list are sibling panels with no common ancestor
 * holding this state, so the request travels as a window event. Declared here
 * rather than as a string literal in both files, so the name and payload can
 * only ever disagree at compile time.
 */
export const OPEN_SOURCE_EVENT = "writhing:open-source";

export interface OpenSourceDetail {
  sourceId: string;
  /** 1-based page in the original PDF. */
  page: number;
  /** The cited passage, highlighted in the page once located. */
  passage?: string;
}

export function openSourceAtPage(detail: OpenSourceDetail): void {
  window.dispatchEvent(
    new CustomEvent<OpenSourceDetail>(OPEN_SOURCE_EVENT, { detail }),
  );
}

export function onOpenSource(
  handler: (detail: OpenSourceDetail) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<OpenSourceDetail>).detail);
  };
  window.addEventListener(OPEN_SOURCE_EVENT, listener);
  return () => window.removeEventListener(OPEN_SOURCE_EVENT, listener);
}

/**
 * Short name for a citation pill — an author surname where we have one, since
 * that is how a reader refers to a source ("Colton, p.1"). Falls back through
 * title to filename so the pill is never blank.
 */
export function shortSourceLabel(source: {
  authors?: string[] | null;
  title?: string | null;
  filename: string;
}): string {
  const firstAuthor = source.authors?.[0]?.trim();
  if (firstAuthor) {
    // "Colton, Timothy J." -> "Colton"; "Timothy Colton" -> "Colton"
    const surname = firstAuthor.includes(",")
      ? firstAuthor.split(",")[0]
      : firstAuthor.split(/\s+/).pop();
    if (surname) return surname.trim();
  }

  const title = source.title?.trim();
  if (title) {
    const words = title.split(/\s+/);
    return words.length > 3 ? `${words.slice(0, 3).join(" ")}…` : title;
  }

  return source.filename.replace(/\.pdf$/i, "").slice(0, 24);
}
