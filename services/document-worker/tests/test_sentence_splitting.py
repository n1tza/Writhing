"""Covers the two failure modes the naive '. ' splitter had.

A mid-sentence cut becomes a quotable fragment the model may cite, and an
over-cap chunk blows the embedding budget, so both are regressions worth
guarding rather than incidental behaviour.
"""

import pytest
from base import RawParagraph
from chunking.strategy import chunk_paragraphs, _count_tokens, _split_sentences
from constants import MAX_CHUNK_TOKENS


def make_para(text: str, section_title: str = "Results") -> RawParagraph:
    return RawParagraph(
        text=text,
        page_start=1,
        page_end=1,
        section_title=section_title,
        section_path=[section_title],
        char_start=0,
        char_end=len(text),
    )


@pytest.mark.parametrize(
    "text",
    [
        "Smith et al. (2020) found a significant effect across both cohorts.",
        "The main effect was reliable, p < 0.05, in every condition tested.",
        "As shown in Fig. 3, the trend holds under the stricter threshold.",
        "Prior work (cf. Jones, 1998, pp. 22-31) reports the opposite result.",
        "Reaction times fell, i.e. participants responded faster over time.",
    ],
)
def test_abbreviations_do_not_break_sentences(text):
    assert _split_sentences(text) == [text]


def test_question_and_exclamation_are_boundaries():
    assert _split_sentences("Does it replicate? It does! We think so.") == [
        "Does it replicate?",
        "It does!",
        "We think so.",
    ]


@pytest.mark.parametrize(
    "text",
    [
        "clause " * 900 + "end.",                              # spaces only
        ", ".join(f"item {i}" for i in range(600)) + ".",      # commas only
        "x" * 12000 + ".",                                     # no separators
    ],
    ids=["run_on_words", "comma_list", "no_separators"],
)
def test_no_chunk_exceeds_the_cap(text):
    chunks = chunk_paragraphs([make_para(text)])
    assert chunks
    for chunk in chunks:
        assert _count_tokens(chunk.text) <= MAX_CHUNK_TOKENS


@pytest.mark.parametrize(
    "text",
    [
        "clause " * 900 + "end.",
        ", ".join(f"item {i}" for i in range(600)) + ".",
        "x" * 12000 + ".",
    ],
    ids=["run_on_words", "comma_list", "no_separators"],
)
def test_splitting_preserves_content(text):
    # Whitespace between chunks is normalised, but no other character may be
    # dropped -- an evidence unit has to quote the source verbatim.
    chunks = chunk_paragraphs([make_para(text)])
    rejoined = "".join(chunk.text for chunk in chunks)
    assert rejoined.replace(" ", "") == text.replace(" ", "")


def test_long_academic_paragraph_splits_on_sentence_boundaries():
    sentences = (
        "Smith et al. (2020) reported a significant effect, p < 0.05. "
        "As shown in Fig. 3, the trend holds across conditions, e.g. both cohorts. "
        "Prior work (cf. Jones, 1998, pp. 22-31) disagrees. "
    )
    chunks = chunk_paragraphs([make_para(sentences * 12)])
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.text.rstrip().endswith((".", "?", "!"))
