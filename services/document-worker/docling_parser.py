from pathlib import Path
from docling.document_converter import DocumentConverter
from base import ParsedDocument, RawParagraph, DocMeta

# What Docling actually calls a heading. Note 'page_header' is deliberately
# excluded -- that is the running head (journal name, page number), not a
# section. Testing for the substring 'heading' matches none of these.
_HEADING_LABELS = {"title", "section_header"}


def _label_of(element) -> str:
    label = getattr(element, "label", None)
    if label is None:
        return ""
    return str(getattr(label, "value", label)).lower()


class DoclingParser:
    def __init__(self):
        self._converter = DocumentConverter()

    def parse(self, pdf_path: Path) -> ParsedDocument:
        result = self._converter.convert(str(pdf_path))
        doc = result.document

        paragraphs: list[RawParagraph] = []
        # Running heading ancestry, indexed by heading level, so body text
        # inherits the section it sits under.
        section_stack: list[str] = []

        for element, _level in doc.iterate_items():
            text = element.text if hasattr(element, 'text') else None
            if not text or not text.strip():
                continue

            # Extract page number
            page_no = 1
            if hasattr(element, 'prov') and element.prov:
                page_no = element.prov[0].page_no if element.prov[0].page_no else 1

            # Section ancestry. A heading opens a section at its own level and
            # closes any deeper ones; everything after it inherits that section
            # until the next heading. Without this, body paragraphs carry no
            # section at all and the chunker's section-boundary rule never
            # fires, since every paragraph looks like it belongs to None.
            stripped = text.strip()
            if _label_of(element) in _HEADING_LABELS:
                level = getattr(element, 'level', 1) or 1
                section_stack = section_stack[:level - 1]
                section_stack.append(stripped)

            section_title: str | None = section_stack[-1] if section_stack else None
            section_path: list[str] = list(section_stack)

            # Character offsets. Docling names this `charspan` and it is a
            # (start, end) tuple, not an object with .start/.end. These offsets
            # are relative to the element's own text, not the whole document.
            char_start = 0
            char_end = len(text)
            if hasattr(element, 'prov') and element.prov:
                prov = element.prov[0]
                charspan = getattr(prov, 'charspan', None)
                if charspan:
                    char_start, char_end = charspan[0], charspan[1]

            paragraphs.append(RawParagraph(
                text=text.strip(),
                page_start=page_no,
                page_end=page_no,
                section_title=section_title,
                section_path=section_path,
                char_start=char_start,
                char_end=char_end,
                label=_label_of(element),
            ))

        # Extract metadata.
        #
        # NOTE: this never fires against Docling 2.x. DoclingDocument has no
        # `metadata` attribute -- it exposes `origin`, which carries only
        # mimetype, binary_hash, filename and uri. Docling does not do
        # bibliographic extraction at all, so title/authors/year/doi will need a
        # separate source (GROBID, a Crossref DOI lookup, or an LLM pass over
        # the first page) before bibliography_items can be populated. Kept as a
        # forward-compatible no-op rather than silently inventing values.
        meta = DocMeta()
        if hasattr(doc, 'metadata') and doc.metadata:
            m = doc.metadata
            meta.title = getattr(m, 'title', None)
            meta.authors = getattr(m, 'authors', []) or []
            meta.doi = getattr(m, 'doi', None)
            if hasattr(m, 'year'):
                meta.year = int(m.year) if m.year else None

        return ParsedDocument(paragraphs=paragraphs, meta=meta)
