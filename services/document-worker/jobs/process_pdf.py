import tempfile
from pathlib import Path

from db import get_client
from docling_parser import DoclingParser
from chunking.strategy import chunk_paragraphs, is_evidence
from embeddings.embed import embed_texts

STORAGE_BUCKET = "source-pdfs"

_parser = DoclingParser()


def _clear_derived_rows(supabase, source_id: str) -> None:
    """
    Remove the evidence a previous run produced for this source.

    Called before writing and again on failure. Without it a retry after a
    partial run doubles the evidence pool -- there is no unique constraint on
    (source_id, text_hash) to catch it.

    bibliography_items is deliberately left alone: the user fills it in at
    upload time and it is not ours to discard. It is upserted on source_id
    instead, so a reprocess updates rather than duplicates.
    """
    supabase.table("evidence_units").delete().eq("source_id", source_id).execute()


def _prefer_existing(existing, parsed):
    """User-entered metadata always wins over anything the parser produced."""
    if existing not in (None, "", []):
        return existing
    return parsed


def _build_csl(row: dict) -> dict:
    """Minimal CSL-JSON, the interchange format citation renderers expect."""
    csl = {
        "type": "article-journal" if row.get("journal") else "book",
        "title": row.get("title"),
        "author": [{"literal": a} for a in (row.get("authors") or [])],
        "container-title": row.get("journal"),
        "publisher": row.get("publisher"),
        "DOI": row.get("doi"),
        "URL": row.get("url"),
    }
    if row.get("year"):
        csl["issued"] = {"date-parts": [[row["year"]]]}
    return {k: v for k, v in csl.items() if v not in (None, [], "")}


def process_source(source_id: str) -> None:
    supabase = get_client()

    # 1. Fetch the source_documents row
    result = (
        supabase.table("source_documents")
        .select("*")
        .eq("id", source_id)
        .execute()
    )
    if not result.data:
        raise ValueError(f"source_documents row not found for id: {source_id}")

    source = result.data[0]

    try:
        # 2. Set status to processing
        supabase.table("source_documents").update({
            "status": "processing",
            "error_message": None,
        }).eq("id", source_id).execute()

        # A retry must not stack on top of a previous attempt's output.
        _clear_derived_rows(supabase, source_id)

        # 3. Download PDF from Supabase Storage to a temp file
        storage_path = source["storage_path"]
        pdf_bytes = supabase.storage.from_(STORAGE_BUCKET).download(storage_path)

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = Path(tmp.name)

        # 4. Parse. The temp file is removed even if parsing raises, which for a
        # corrupt upload it will.
        try:
            parsed = _parser.parse(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)

        # 5. Chunk, keeping only what belongs in the retrievable evidence pool.
        # Reference apparatus ("Ibid., p. 27") is not something the AI can cite
        # in support of a claim -- see is_evidence.
        chunks = [c for c in chunk_paragraphs(parsed.paragraphs) if is_evidence(c)]

        if not chunks:
            raise ValueError(f"No chunks extracted from PDF: {storage_path}")

        # 6. Embed all chunk texts in one call (batching handled internally)
        texts = [chunk.text for chunk in chunks]
        embeddings = embed_texts(texts)

        if len(embeddings) != len(chunks):
            raise ValueError(
                f"Embedding count mismatch: {len(embeddings)} embeddings for {len(chunks)} chunks"
            )

        # 7. Insert evidence_units in bulk.
        # chunk_index is the position in document order, used by
        # expand_evidence_context to widen a retrieved passage to its
        # neighbours. Indexed over the stored chunks rather than all chunks, so
        # the sequence stays contiguous where a reference footnote was filtered
        # out and a window never lands on a hole.
        evidence_rows = [
            {
                "source_id": source_id,
                "chunk_index": index,
                "text": chunk.text,
                "text_hash": chunk.text_hash,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "section_title": chunk.section_title,
                "section_path": chunk.section_path,
                "char_start": chunk.char_start,
                "char_end": chunk.char_end,
                "embedding": embedding,
            }
            for index, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]

        supabase.table("evidence_units").insert(evidence_rows).execute()

        # 8. Merge parsed metadata into bibliography_items.
        # Docling extracts no bibliographic metadata today, so in practice this
        # preserves what the user typed. Written as a merge so that when a real
        # extractor lands (GROBID, a Crossref DOI lookup) it fills blanks
        # without overwriting corrections the user made by hand.
        meta = parsed.meta
        found = (
            supabase.table("bibliography_items")
            .select("*")
            .eq("source_id", source_id)
            .execute()
            .data
        )
        existing = found[0] if found else {}

        bib_row = {
            "source_id": source_id,
            "title": _prefer_existing(existing.get("title"), meta.title),
            "authors": _prefer_existing(existing.get("authors"), meta.authors or []),
            "year": _prefer_existing(existing.get("year"), meta.year),
            "doi": _prefer_existing(existing.get("doi"), meta.doi),
            "journal": existing.get("journal"),
            "publisher": existing.get("publisher"),
            "url": existing.get("url"),
        }
        bib_row["csl_json"] = _build_csl(bib_row)

        supabase.table("bibliography_items").upsert(
            bib_row, on_conflict="source_id"
        ).execute()

        # 9. Set status to ready
        supabase.table("source_documents").update({
            "status": "ready"
        }).eq("id", source_id).execute()

    except Exception as e:
        # On any failure: drop whatever was written, record the error, re-raise.
        # A failure partway through step 7/8 would otherwise leave a half-built
        # evidence pool that reads as legitimate to the retriever.
        try:
            _clear_derived_rows(supabase, source_id)
        except Exception:
            pass

        supabase.table("source_documents").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", source_id).execute()
        raise
