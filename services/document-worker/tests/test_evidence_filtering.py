"""Headings, footnote triage, and provenance grouping.

Fixtures are real text from a scanned academic source, including its OCR
artefacts ("Tbid" for "Ibid"), because that is what the classifier actually has
to cope with.
"""

import pytest
from base import RawParagraph
from chunking.strategy import chunk_paragraphs, is_evidence, _is_citation_only
from constants import REFERENCE_LABEL


def make_para(text, label="text", section_title="Results", page=1):
    return RawParagraph(
        text=text,
        page_start=page,
        page_end=page,
        section_title=section_title,
        section_path=[section_title],
        char_start=0,
        char_end=len(text),
        label=label,
    )


# --- headings are metadata, not evidence -----------------------------------

def test_heading_is_not_emitted_as_a_chunk():
    paras = [
        make_para("CONCLUSION", label="section_header", section_title="CONCLUSION"),
        make_para("The argument rests on two claims about authority.", section_title="CONCLUSION"),
    ]
    chunks = chunk_paragraphs(paras)
    assert all("CONCLUSION" != c.text.strip() for c in chunks)
    assert len(chunks) == 1


def test_heading_still_closes_the_previous_group():
    paras = [
        make_para("Short body line.", section_title="Intro"),
        make_para("METHODS", label="section_header", section_title="Methods"),
        make_para("Another short line.", section_title="Methods"),
    ]
    chunks = chunk_paragraphs(paras)
    assert len(chunks) == 2
    assert "Short body line." in chunks[0].text
    assert "Another short line." in chunks[1].text


# --- footnote triage --------------------------------------------------------

REFERENCE_NOTES = [
    "3* Tbid.",
    "58 Ibid., pp. 72-3.",
    "33 Brown, The Gorbachev Factor, pp. 31-2.",
    "48 See Aron, Boris Yeltsin, pp. 60-78.",
    "2 Mikhail Gorbachev, Zhizn' i reformy, vol. 1 (Moscow: Novosti, 1996), p. 56.",
    "8 Ken Jowitt, New World Disorder: The Leninist Extinction "
    "(Berkeley: University of California Press, 1992), ch. 6.",
    "57 On Yeltsin's self-image, see Yeltsin, Against the Grain, pp. 76-80, 108-10.",
]

SUBSTANTIVE_NOTES = [
    "3 These were impressions an American journalist reached from interviewing "
    "people who knew Gorbachev as a young man.",
    "4\" Gorbachev's prime minister, Nikolai Ryzhkov, claims in his memoirs that "
    "he warned Gorbachev against appointing Yeltsin.",
    "7° Yeltsin's former advisors and associates write: 'A builder by profession, "
    "he sought out projects that could yield tangible results.'",
    "6° A source that cannot be cited also told me that, when Yeltsin was in Texas "
    "in 1989, he became angry at something said by his hosts.",
]


@pytest.mark.parametrize("text", REFERENCE_NOTES)
def test_reference_apparatus_is_detected(text):
    assert _is_citation_only(text)


@pytest.mark.parametrize("text", SUBSTANTIVE_NOTES)
def test_substantive_footnotes_are_kept(text):
    assert not _is_citation_only(text)


def test_reference_footnotes_are_relabelled_not_dropped():
    paras = [make_para("58 Ibid., pp. 72-3.", label="footnote")]
    chunks = chunk_paragraphs(paras)
    # Kept, so bibliography extraction can still use it...
    assert len(chunks) == 1
    assert chunks[0].label == REFERENCE_LABEL
    # ...but excluded from the retrievable evidence pool.
    assert not is_evidence(chunks[0])


def test_substantive_footnote_stays_in_the_evidence_pool():
    chunks = chunk_paragraphs([make_para(SUBSTANTIVE_NOTES[1], label="footnote")])
    assert len(chunks) == 1
    assert is_evidence(chunks[0])


# --- provenance grouping ----------------------------------------------------

def test_footnotes_do_not_merge_with_body_prose():
    paras = [
        make_para("A short body sentence."),
        make_para(SUBSTANTIVE_NOTES[0], label="footnote"),
    ]
    chunks = chunk_paragraphs(paras)
    assert len(chunks) == 2
    assert chunks[0].label == "text"
    assert chunks[1].label == "footnote"


def test_reference_notes_do_not_merge_with_substantive_ones():
    paras = [
        make_para("58 Ibid., pp. 72-3.", label="footnote"),
        make_para(SUBSTANTIVE_NOTES[0], label="footnote"),
    ]
    chunks = chunk_paragraphs(paras)
    assert {c.label for c in chunks} == {REFERENCE_LABEL, "footnote"}


def test_chunk_carries_its_label():
    chunks = chunk_paragraphs([make_para("A bullet point of some length here.", label="list_item")])
    assert chunks[0].label == "list_item"
    assert is_evidence(chunks[0])
