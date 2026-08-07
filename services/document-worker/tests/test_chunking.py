import pytest
from base import RawParagraph
from chunking.strategy import chunk_paragraphs


def make_para(text: str, section_title: str = "Introduction", page: int = 1) -> RawParagraph:
    return RawParagraph(
        text=text,
        page_start=page,
        page_end=page,
        section_title=section_title,
        section_path=[section_title],
        char_start=0,
        char_end=len(text),
    )


def test_normal_paragraph_passes_through():
    # ~80 tokens — should pass through as a single chunk unchanged
    text = "This is a normal paragraph. " * 6
    chunks = chunk_paragraphs([make_para(text)])
    assert len(chunks) == 1
    assert text.strip() in chunks[0].text


def test_short_paragraphs_same_section_are_merged():
    # Each paragraph is ~10 tokens — both should merge into one chunk
    p1 = make_para("Short paragraph one.", section_title="Methods")
    p2 = make_para("Short paragraph two.", section_title="Methods")
    chunks = chunk_paragraphs([p1, p2])
    assert len(chunks) == 1
    assert "Short paragraph one" in chunks[0].text
    assert "Short paragraph two" in chunks[0].text


def test_short_paragraphs_different_sections_not_merged():
    p1 = make_para("Short paragraph one.", section_title="Introduction")
    p2 = make_para("Short paragraph two.", section_title="Methods")
    chunks = chunk_paragraphs([p1, p2])
    assert len(chunks) == 2


def test_long_paragraph_is_split():
    # ~500 tokens — should produce multiple chunks each under MAX_CHUNK_TOKENS
    sentence = "This is a sentence that takes up space in the token count. "
    text = sentence * 30
    chunks = chunk_paragraphs([make_para(text)])
    assert len(chunks) > 1
    for chunk in chunks:
        from chunking.strategy import _count_tokens
        assert _count_tokens(chunk.text) <= 350


def test_no_mid_sentence_splits():
    sentence = "Each sentence ends with a period. "
    text = sentence * 30
    chunks = chunk_paragraphs([make_para(text)])
    for chunk in chunks:
        # Every chunk should end with a period (no mid-sentence cut)
        assert chunk.text.strip().endswith('.')


def test_empty_paragraph_is_skipped():
    p1 = make_para("   ")
    p2 = make_para("A real paragraph with content here.")
    chunks = chunk_paragraphs([p1, p2])
    assert len(chunks) == 1


def test_merged_chunk_carries_correct_page_range():
    p1 = make_para("Short one.", page=3)
    p1.page_start = 3
    p1.page_end = 3
    p2 = make_para("Short two.", page=4)
    p2.page_start = 4
    p2.page_end = 4
    # Force same section so they merge
    p1.section_title = "Results"
    p2.section_title = "Results"
    chunks = chunk_paragraphs([p1, p2])
    assert chunks[0].page_start == 3
    assert chunks[0].page_end == 4


def test_text_hash_is_deterministic():
    p = make_para("Consistent text produces consistent hash.")
    chunks1 = chunk_paragraphs([p])
    chunks2 = chunk_paragraphs([p])
    assert chunks1[0].text_hash == chunks2[0].text_hash
