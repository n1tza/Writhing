import hashlib
import re
from dataclasses import replace

import pysbd
import tiktoken
from base import RawParagraph, EvidenceChunk
from constants import (
    FOOTNOTE_LABEL,
    HEADING_LABELS,
    MAX_CHUNK_TOKENS,
    MIN_CHUNK_TOKENS,
    MIN_FOOTNOTE_PROSE_TOKENS,
    REFERENCE_LABEL,
    EVIDENCE_LABELS,
)

_enc = tiktoken.get_encoding("cl100k_base")

# Pragmatic sentence boundary disambiguation. A naive split on '. ' cuts inside
# 'Smith et al. (2020)', 'p < 0.05', 'Fig. 3' and 'i.e.', and misses '?' and '!'
# entirely -- all common in academic prose. A mid-sentence cut here becomes a
# quotable fragment the model may cite, so the boundaries have to be right.
# clean=False keeps the original text intact rather than normalising whitespace.
_segmenter = pysbd.Segmenter(language="en", clean=False)

# Tried in order when a single sentence exceeds the token cap, coarsest first,
# so a forced split lands on the most natural boundary available.
_FALLBACK_SEPARATORS = ["; ", ": ", ", ", " "]


# --- footnote triage -------------------------------------------------------
#
# In academic sources most footnotes are pure reference apparatus -- "Ibid.",
# "Brown, The Gorbachev Factor, pp. 31-2." -- which carry no assertable claim.
# Embedding them makes a third of the evidence pool unciteable noise. Others are
# substantive and belong in the pool. Length alone does not separate the two: a
# full bibliographic entry can run 35 tokens while a real aside runs 60.
#
# So the apparatus is stripped and what remains is measured. Ibid variants
# include OCR spellings ("Tbid", "Thid") seen in real scanned sources.

_NOTE_MARKER = re.compile(r"^[\s\W\d]{0,8}")
_PARENTHETICAL = re.compile(r"\([^)]*\)")
_LOCATOR = re.compile(
    r"\b(?:pp?|chs?|vols?|nos?|fns?|eds?|edn?|trans|comp|rev"
    r"|ibid|tbid|thid|idem|op\.?\s*cit|loc\.?\s*cit|passim|ff)\b\.?",
    re.IGNORECASE,
)
_NUMBERING = re.compile(r"\b[\dIVXLivxl]+(?:\s*[-–—]{1,2}\s*[\dIVXLivxl]+)?\b")

# Residual length alone cannot separate the two: a book title is long and reads
# as prose, so "Ken Jowitt, New World Disorder: The Leninist Extinction" scores
# the same as a real aside. The structural difference is grammatical -- a
# substantive note is a sentence with a finite verb, a bibliographic entry is a
# noun phrase. This is a deliberately shallow proxy for that; a POS tagger would
# be more accurate but would pull spaCy and a model download into the worker for
# a decision that is already biased toward keeping.
_FINITE_VERB = re.compile(
    r"\b(?:is|are|was|were|be|been|has|have|had|do|does|did|can|could|will"
    r"|would|shall|should|may|might|must|claims?|claimed|reports?|reported"
    r"|argues?|argued|writes?|wrote|notes?|noted|says?|said|finds?|found"
    r"|shows?|showed|suggests?|suggested|knew|knows?|became|become|sought"
    r"|seeks?|reached|told|learned|learnt|appeared|appears?|agree[sd]?"
    r"|holds?|held|treats?|treated|offers?|offered|includes?|included)\b",
    re.IGNORECASE,
)


def _prose_tokens(text: str) -> int:
    """Token count of a footnote once its bibliographic apparatus is removed."""
    residual = _strip_apparatus(text)
    return _count_tokens(residual) if residual else 0


def _strip_apparatus(text: str) -> str:
    residual = _NOTE_MARKER.sub("", text)
    residual = _PARENTHETICAL.sub(" ", residual)
    residual = _LOCATOR.sub(" ", residual)
    residual = _NUMBERING.sub(" ", residual)
    # Whatever is left is author names, titles and prose; punctuation between
    # bibliographic fields is not content.
    residual = re.sub(r"[^\w\s]", " ", residual)
    return re.sub(r"\s+", " ", residual).strip()


def _is_citation_only(text: str) -> bool:
    """
    True when a footnote is reference apparatus rather than an assertable claim.

    Two ways to qualify: almost nothing survives the apparatus strip ("Ibid.,
    p. 27"), or what survives has no finite verb, which is what a pure
    author-title-publisher listing looks like.
    """
    residual = _strip_apparatus(text)
    if _count_tokens(residual) < MIN_FOOTNOTE_PROSE_TOKENS:
        return not _FINITE_VERB.search(residual)
    return False


def _count_tokens(text: str) -> int:
    return len(_enc.encode(text))


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _segmenter.segment(text) if s.strip()]


def _hard_split_tokens(text: str) -> list[str]:
    """Last resort: slice on token boundaries so the cap always holds."""
    tokens = _enc.encode(text)
    return [
        _enc.decode(tokens[i:i + MAX_CHUNK_TOKENS]).strip()
        for i in range(0, len(tokens), MAX_CHUNK_TOKENS)
    ]


def _split_oversized_sentence(sentence: str) -> list[str]:
    """
    Break a single sentence that is longer than MAX_CHUNK_TOKENS on its own.

    Recursive-separator splitting: try clause punctuation before whitespace, and
    only fall back to slicing raw tokens if no separator yields pieces that fit.
    Rare in practice -- it takes a run-on sentence or a table flattened into
    prose -- but without it a single element can exceed the embedding budget.
    """
    if _count_tokens(sentence) <= MAX_CHUNK_TOKENS:
        return [sentence]

    for separator in _FALLBACK_SEPARATORS:
        if separator not in sentence:
            continue

        # The separator stays attached to the part before it, so concatenating
        # the pieces reproduces the sentence exactly. Dropping it at each split
        # boundary would make the stored text a near-miss for the source, and
        # evidence units have to quote the PDF verbatim to be verifiable.
        parts = sentence.split(separator)
        units = [part + separator for part in parts[:-1]] + parts[-1:]

        pieces: list[str] = []
        current = ""
        for unit in units:
            if current and _count_tokens(current + unit) > MAX_CHUNK_TOKENS:
                pieces.append(current)
                current = unit
            else:
                current += unit
        if current:
            pieces.append(current)

        # A single part may still be too long for this separator; recurse on the
        # next one down rather than accepting an over-cap piece.
        if all(_count_tokens(piece) <= MAX_CHUNK_TOKENS for piece in pieces):
            return [piece.strip() for piece in pieces if piece.strip()]

    return [piece for piece in _hard_split_tokens(sentence) if piece]


def _make_chunk(paragraphs: list[RawParagraph], text: str) -> EvidenceChunk:
    return EvidenceChunk(
        text=text,
        text_hash=_hash(text),
        page_start=paragraphs[0].page_start,
        page_end=paragraphs[-1].page_end,
        section_title=paragraphs[0].section_title,
        section_path=paragraphs[0].section_path,
        char_start=paragraphs[0].char_start,
        char_end=paragraphs[-1].char_end,
        label=paragraphs[0].label,
    )


def _provenance(label: str) -> str:
    if label == REFERENCE_LABEL:
        return "reference"
    if label == FOOTNOTE_LABEL:
        return "footnote"
    return "body"


def _group_key(para: RawParagraph) -> tuple[str | None, str]:
    """
    What makes two paragraphs mergeable.

    Section, plus provenance: a note and the body prose it hangs off are
    different kinds of source, and merging them would produce a chunk that cites
    neither cleanly.
    """
    return (para.section_title, _provenance(para.label))


def _split_long_paragraph(para: RawParagraph) -> list[EvidenceChunk]:
    # Any sentence too long to ever fit is broken down before packing, so the
    # packer only ever handles units it can actually place.
    sentences: list[str] = []
    for sentence in _split_sentences(para.text):
        sentences.extend(_split_oversized_sentence(sentence))

    chunks = []
    current_sentences: list[str] = []

    for sentence in sentences:
        # Measured on the joined text, not a running sum: joining can tokenise
        # differently from the parts, and the cap has to hold on what is stored.
        candidate = ' '.join(current_sentences + [sentence])
        if current_sentences and _count_tokens(candidate) > MAX_CHUNK_TOKENS:
            chunks.append(_make_chunk([para], ' '.join(current_sentences)))
            current_sentences = [sentence]
        else:
            current_sentences.append(sentence)

    if current_sentences:
        chunks.append(_make_chunk([para], ' '.join(current_sentences)))

    return chunks


def chunk_paragraphs(paragraphs: list[RawParagraph]) -> list[EvidenceChunk]:
    chunks: list[EvidenceChunk] = []
    pending: list[RawParagraph] = []
    pending_tokens: int = 0

    def flush():
        # nonlocal so the running total can never outlive the paragraphs it
        # counted; a stale count would flush the next group too early.
        nonlocal pending_tokens
        if not pending:
            pending_tokens = 0
            return
        text = ' '.join(p.text for p in pending)
        chunks.append(_make_chunk(pending, text))
        pending.clear()
        pending_tokens = 0

    for para in paragraphs:
        text = para.text.strip()
        if not text:
            continue

        # Headings are section metadata, not evidence. "CONCLUSION" as a
        # citable unit is useless, and the text is already on every chunk in the
        # section as section_title. It still closes the preceding group.
        if para.label in HEADING_LABELS:
            flush()
            continue

        # Reference-only footnotes carry no claim to cite, but are kept and
        # relabelled rather than dropped -- see REFERENCE_LABEL.
        if para.label == FOOTNOTE_LABEL and _is_citation_only(text):
            para = replace(para, label=REFERENCE_LABEL)

        token_count = _count_tokens(text)

        # Over the max — split immediately, flush any pending first
        if token_count > MAX_CHUNK_TOKENS:
            flush()
            chunks.extend(_split_long_paragraph(para))
            continue

        # Would cross a section or provenance boundary — flush before starting
        # the new group
        if pending and _group_key(para) != _group_key(pending[0]):
            flush()

        # Under the min — merge into pending
        if token_count < MIN_CHUNK_TOKENS:
            pending.append(para)
            pending_tokens += token_count
            # If merged group is now over the min, flush it
            if pending_tokens >= MIN_CHUNK_TOKENS:
                flush()
            continue

        # Normal paragraph — flush pending first, then emit this one directly
        flush()
        chunks.append(_make_chunk([para], text))

    # Flush any remaining pending paragraphs
    flush()

    return chunks


def is_evidence(chunk: EvidenceChunk) -> bool:
    """
    Whether a chunk belongs in the retrievable evidence pool.

    The embedding and database steps should use this rather than filtering on
    labels inline, so the policy lives in one place.
    """
    return chunk.label in EVIDENCE_LABELS
