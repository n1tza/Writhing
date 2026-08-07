"""Embedding logic that does not need the network.

test_embedding.py covers the real API but skips entirely without a key, which
would leave batching, ordering and error handling unverified on any machine
that has not configured one -- including CI. These stub the client instead, so
the parts that are our code rather than OpenAI's are always exercised.
"""

import httpx
import pytest
from openai import RateLimitError

from constants import EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL
from embeddings import embed as embed_module
from embeddings.embed import embed_texts


class _StubEmbeddings:
    def __init__(self, parent):
        self._parent = parent

    def create(self, model, input):
        self._parent.calls.append({"model": model, "input": list(input)})
        error = self._parent.errors.pop(0) if self._parent.errors else None
        if error:
            raise error
        dims = self._parent.dimensions
        data = [
            type("Item", (), {"embedding": [float(i)] * dims})()
            for i, _ in enumerate(input)
        ]
        return type("Response", (), {"data": data})()


class StubClient:
    def __init__(self, dimensions=EMBEDDING_DIMENSIONS, errors=None):
        self.calls = []
        self.dimensions = dimensions
        self.errors = list(errors or [])
        self.embeddings = _StubEmbeddings(self)


@pytest.fixture
def stub(monkeypatch):
    client = StubClient()
    monkeypatch.setattr(embed_module, "_get_client", lambda: client)
    monkeypatch.setattr(embed_module.time, "sleep", lambda _: None)
    return client


def _rate_limit_error():
    request = httpx.Request("POST", "https://api.openai.com/v1/embeddings")
    response = httpx.Response(429, request=request)
    return RateLimitError("rate limited", response=response, body=None)


# --- batching ---------------------------------------------------------------

def test_empty_input_makes_no_api_call(stub):
    assert embed_texts([]) == []
    assert stub.calls == []


@pytest.mark.parametrize(
    "count,expected_batch_sizes",
    [
        (1, [1]),
        (EMBEDDING_BATCH_SIZE - 1, [EMBEDDING_BATCH_SIZE - 1]),
        (EMBEDDING_BATCH_SIZE, [EMBEDDING_BATCH_SIZE]),
        (EMBEDDING_BATCH_SIZE + 1, [EMBEDDING_BATCH_SIZE, 1]),
        (150, [100, 50]),
        (250, [100, 100, 50]),
    ],
)
def test_batching_boundaries(stub, count, expected_batch_sizes):
    texts = [f"text {i}" for i in range(count)]
    result = embed_texts(texts)
    assert len(result) == count
    assert [len(call["input"]) for call in stub.calls] == expected_batch_sizes


def test_every_input_is_sent_exactly_once_and_in_order(stub):
    texts = [f"text {i}" for i in range(250)]
    embed_texts(texts)
    sent = [t for call in stub.calls for t in call["input"]]
    assert sent == texts


def test_uses_the_model_from_constants(stub):
    embed_texts(["anything"])
    assert stub.calls[0]["model"] == EMBEDDING_MODEL


# --- dimension validation ---------------------------------------------------

def test_wrong_dimensions_raise_value_error(monkeypatch):
    client = StubClient(dimensions=512)
    monkeypatch.setattr(embed_module, "_get_client", lambda: client)
    with pytest.raises(ValueError) as excinfo:
        embed_texts(["text"])
    # Not rewrapped as a generic batch failure — a mismatch means index-time and
    # query-time vectors are incomparable, so the cause must stay legible.
    assert str(EMBEDDING_DIMENSIONS) in str(excinfo.value)
    assert "512" in str(excinfo.value)


# --- retry behaviour --------------------------------------------------------

def test_rate_limit_is_retried_then_succeeds(monkeypatch):
    client = StubClient(errors=[_rate_limit_error(), _rate_limit_error()])
    monkeypatch.setattr(embed_module, "_get_client", lambda: client)
    monkeypatch.setattr(embed_module.time, "sleep", lambda _: None)
    result = embed_texts(["text"])
    assert len(result) == 1
    assert len(client.calls) == 3


def test_third_consecutive_rate_limit_raises(monkeypatch):
    client = StubClient(errors=[_rate_limit_error() for _ in range(3)])
    monkeypatch.setattr(embed_module, "_get_client", lambda: client)
    monkeypatch.setattr(embed_module.time, "sleep", lambda _: None)
    with pytest.raises(RateLimitError):
        embed_texts(["text"])
    assert len(client.calls) == 3


def test_backoff_doubles_between_attempts(monkeypatch):
    client = StubClient(errors=[_rate_limit_error(), _rate_limit_error()])
    monkeypatch.setattr(embed_module, "_get_client", lambda: client)
    slept = []
    monkeypatch.setattr(embed_module.time, "sleep", slept.append)
    embed_texts(["text"])
    assert slept == [1.0, 2.0]


def test_other_errors_raise_immediately_with_batch_index(monkeypatch):
    # Fails on the second batch, so the reported index must not be 0.
    client = StubClient(errors=[None, RuntimeError("boom")])
    monkeypatch.setattr(embed_module, "_get_client", lambda: client)
    with pytest.raises(RuntimeError) as excinfo:
        embed_texts([f"text {i}" for i in range(150)])
    assert "batch 1" in str(excinfo.value)
    # No retry for non-rate-limit failures.
    assert len(client.calls) == 2


def test_missing_api_key_raises_a_clear_error(monkeypatch):
    monkeypatch.setattr(embed_module, "_client", None)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        embed_texts(["text"])
