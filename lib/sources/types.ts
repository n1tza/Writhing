/** Lifecycle of an uploaded PDF, mirrored from `source_documents.status`. */
export type SourceStatus = "uploaded" | "processing" | "ready" | "failed";

/**
 * Bibliographic details the parser cannot recover.
 *
 * Docling extracts no metadata at all, so today every field here comes from the
 * user. When an extractor lands (GROBID, a Crossref DOI lookup) it fills blanks
 * only — the worker merges rather than overwrites, so hand corrections survive
 * a reprocess.
 */
export interface SourceMetadata {
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  publisher: string | null;
  doi: string | null;
  url: string | null;
}

export interface Source {
  id: string;
  filename: string;
  storagePath: string;
  status: SourceStatus;
  errorMessage: string | null;
  createdAt: string;
  metadata: SourceMetadata | null;
  /** Number of evidence units extracted, once processing has finished. */
  evidenceCount: number;
}

export const EMPTY_METADATA: SourceMetadata = {
  title: "",
  authors: [],
  year: null,
  journal: null,
  publisher: null,
  doi: null,
  url: null,
};

/** "Smith, J.; Jones, A." <-> ["Smith, J.", "Jones, A."] */
export function parseAuthors(input: string): string[] {
  return input
    .split(/[;\n]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export function formatAuthors(authors: string[]): string {
  return authors.join("; ");
}

/** Strips a doi.org prefix so the stored value is a bare DOI. */
export function normalizeDoi(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

/** A reasonable starting title: the filename without extension or separators. */
export function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}
