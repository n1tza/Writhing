from pathlib import Path
from typing import Protocol
from dataclasses import dataclass, field


@dataclass
class RawParagraph:
    text: str
    page_start: int
    page_end: int
    section_title: str | None
    section_path: list[str]
    char_start: int
    char_end: int
    # Docling element label ("text", "list_item", "footnote", "section_header",
    # ...). Carried through so chunking can tell body prose from reference
    # apparatus instead of treating every element as equivalent evidence.
    label: str = "text"


@dataclass
class EvidenceChunk:
    text: str
    text_hash: str
    page_start: int
    page_end: int
    section_title: str | None
    section_path: list[str]
    char_start: int
    char_end: int
    label: str = "text"


@dataclass
class DocMeta:
    title: str | None = None
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    doi: str | None = None


@dataclass
class ParsedDocument:
    paragraphs: list[RawParagraph]
    meta: DocMeta


class DocumentParser(Protocol):
    def parse(self, pdf_path: Path) -> ParsedDocument: ...
