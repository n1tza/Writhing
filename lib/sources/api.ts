import { createClient } from "@/lib/supabase/client";
import { ensureUser } from "@/lib/supabase/session";
import type { Source, SourceMetadata, SourceStatus } from "./types";

const BUCKET = "source-pdfs";

/** Shape returned by the select below; bibliography_items is a 1:1 join. */
interface SourceRow {
  id: string;
  filename: string;
  storage_path: string;
  status: SourceStatus;
  error_message: string | null;
  created_at: string;
  // An object, not an array: bibliography_items.source_id is unique, so
  // PostgREST infers a to-one relationship and embeds a single row.
  bibliography_items: {
    title: string | null;
    authors: string[] | null;
    year: number | null;
    journal: string | null;
    publisher: string | null;
    doi: string | null;
    url: string | null;
  } | null;
  evidence_units: { count: number }[] | null;
}

function toSource(row: SourceRow): Source {
  const bib = row.bibliography_items ?? null;
  return {
    id: row.id,
    filename: row.filename,
    storagePath: row.storage_path,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    evidenceCount: row.evidence_units?.[0]?.count ?? 0,
    metadata: bib
      ? {
          title: bib.title ?? "",
          authors: bib.authors ?? [],
          year: bib.year,
          journal: bib.journal,
          publisher: bib.publisher,
          doi: bib.doi,
          url: bib.url,
        }
      : null,
  };
}

const SELECT =
  "id, filename, storage_path, status, error_message, created_at, " +
  "bibliography_items(title, authors, year, journal, publisher, doi, url), " +
  "evidence_units(count)";

export async function listSources(): Promise<Source[]> {
  const supabase = createClient();
  await ensureUser();

  const { data, error } = await supabase
    .from("source_documents")
    .select(SELECT)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as unknown as SourceRow[]).map(toSource);
}

/**
 * Upload a PDF and queue it for processing.
 *
 * Order matters: the file lands in storage first, then the row that points at
 * it, then the metadata, and only then is the worker told to start. Triggering
 * earlier would race the worker against its own input.
 */
export async function uploadSource(
  file: File,
  metadata: SourceMetadata,
): Promise<Source> {
  const supabase = createClient();
  const user = await ensureUser();

  // The first path segment is the owner — the storage policies scope on it.
  const objectKey = `${user.id}/${crypto.randomUUID()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(objectKey, file, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { data: row, error: rowError } = await supabase
    .from("source_documents")
    .insert({
      user_id: user.id,
      filename: file.name,
      storage_path: objectKey,
      status: "uploaded",
    })
    .select("id")
    .single();

  if (rowError) {
    // Don't leave an orphaned object behind paying for storage forever.
    await supabase.storage.from(BUCKET).remove([objectKey]);
    throw rowError;
  }

  await saveMetadata(row.id as string, metadata);
  await requestProcessing(row.id as string);

  const sources = await listSources();
  const created = sources.find((s) => s.id === row.id);
  if (!created) throw new Error("Source disappeared immediately after upload");
  return created;
}

export async function saveMetadata(
  sourceId: string,
  metadata: SourceMetadata,
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from("bibliography_items").upsert(
    {
      source_id: sourceId,
      title: metadata.title || null,
      authors: metadata.authors,
      year: metadata.year,
      journal: metadata.journal,
      publisher: metadata.publisher,
      doi: metadata.doi,
      url: metadata.url,
    },
    { onConflict: "source_id" },
  );

  if (error) throw error;
}

/**
 * Ask the worker to process a source. Returns as soon as the job is queued —
 * processing takes minutes, and `status` is the progress channel.
 */
export async function requestProcessing(sourceId: string): Promise<void> {
  const response = await fetch("/api/sources/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not reach the document worker");
  }
}

export async function deleteSource(source: Source): Promise<void> {
  const supabase = createClient();

  // evidence_units and bibliography_items cascade from the row in the app's
  // model but not in the schema, so clear them explicitly first.
  await supabase.from("evidence_units").delete().eq("source_id", source.id);
  await supabase.from("bibliography_items").delete().eq("source_id", source.id);
  await supabase.from("source_documents").delete().eq("id", source.id);
  await supabase.storage.from(BUCKET).remove([source.storagePath]);
}

/** Short-lived URL for previewing the PDF; the bucket is private. */
export async function getPreviewUrl(source: Source): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(source.storagePath, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}
