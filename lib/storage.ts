export const DOC_STORAGE_KEY = "writhing:document";

const DEFAULT_DOC = `<h1>Untitled document</h1><p>Start writing here, or ask the assistant on the right to draft, expand, or rewrite anything. Try: "Write an opening paragraph about the ocean at night."</p>`;

export function loadDocument(): string {
  if (typeof window === "undefined") return DEFAULT_DOC;
  try {
    const stored = window.localStorage.getItem(DOC_STORAGE_KEY);
    return stored && stored.trim().length > 0 ? stored : DEFAULT_DOC;
  } catch {
    return DEFAULT_DOC;
  }
}

export function saveDocument(html: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DOC_STORAGE_KEY, html);
  } catch {
    // Ignore write failures (e.g. storage full or disabled).
  }
}

export function createDebouncedSaver(delayMs = 500): (html: string) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (html: string) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => saveDocument(html), delayMs);
  };
}
