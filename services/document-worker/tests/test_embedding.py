import pytest
import os
from embeddings.embed import embed_texts
from constants import EMBEDDING_DIMENSIONS


# These tests make real API calls — OPENAI_API_KEY must be set
pytestmark = pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"),
    reason="OPENAI_API_KEY not set"
)


def test_output_shape():
    texts = ["first sentence", "second sentence", "third sentence"]
    result = embed_texts(texts)
    assert len(result) == 3
    assert all(len(vec) == EMBEDDING_DIMENSIONS for vec in result)


def test_output_contains_floats():
    result = embed_texts(["test sentence"])
    assert all(isinstance(v, float) for v in result[0])


def test_identical_inputs_produce_identical_vectors():
    text = "identical input text"
    result = embed_texts([text, text])
    assert result[0] == result[1]


def test_different_inputs_produce_different_vectors():
    result = embed_texts(["quantum mechanics", "medieval history"])
    assert result[0] != result[1]


def test_empty_input_returns_empty_list():
    result = embed_texts([])
    assert result == []


def test_large_batch_is_handled():
    # 150 texts — should split into 2 batches of 100 and 50 internally
    texts = [f"sentence number {i}" for i in range(150)]
    result = embed_texts(texts)
    assert len(result) == 150
    assert all(len(vec) == EMBEDDING_DIMENSIONS for vec in result)


def test_order_is_preserved():
    texts = ["alpha", "beta", "gamma"]
    result1 = embed_texts(texts)
    result2 = embed_texts(texts)
    # Same input in same order should produce same output in same order
    assert result1[0] == result2[0]
    assert result1[1] == result2[1]
    assert result1[2] == result2[2]
