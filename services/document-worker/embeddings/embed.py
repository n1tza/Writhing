import time
import os
from openai import OpenAI, RateLimitError
from constants import EMBEDDING_MODEL, EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    """
    Build the client on first use, not at import.

    Constructing it at module level makes `import embed` raise KeyError when
    OPENAI_API_KEY is unset, which fires during test collection -- before any
    skipif can be evaluated -- so tests error instead of skipping.
    """
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set; cannot create embeddings"
            )
        _client = OpenAI(api_key=api_key)
    return _client


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Embed any number of texts using EMBEDDING_MODEL.
    Handles batching internally — callers pass any size list.
    Returns embeddings in the same order as the input.
    Raises on third consecutive RateLimitError.
    Raises immediately on any other exception, including the batch index.
    """
    if not texts:
        return []

    all_embeddings: list[list[float]] = []

    # Split into batches
    batches = [
        texts[i:i + EMBEDDING_BATCH_SIZE]
        for i in range(0, len(texts), EMBEDDING_BATCH_SIZE)
    ]

    for batch_index, batch in enumerate(batches):
        embeddings = _embed_batch_with_retry(batch, batch_index)
        all_embeddings.extend(embeddings)

    return all_embeddings


def _embed_batch_with_retry(batch: list[str], batch_index: int) -> list[list[float]]:
    max_retries = 3
    backoff = 1.0

    for attempt in range(max_retries):
        try:
            response = _get_client().embeddings.create(
                model=EMBEDDING_MODEL,
                input=batch,
            )
            embeddings = [item.embedding for item in response.data]

            # Validate dimensions on first batch only
            if batch_index == 0 and embeddings:
                actual_dims = len(embeddings[0])
                if actual_dims != EMBEDDING_DIMENSIONS:
                    raise ValueError(
                        f"Expected {EMBEDDING_DIMENSIONS} dimensions, "
                        f"got {actual_dims} from model {EMBEDDING_MODEL}"
                    )

            return embeddings

        except ValueError:
            # A dimension mismatch means index-time and query-time vectors would
            # not be comparable. Surfaced as-is rather than rewrapped, so the
            # cause is not buried behind a generic batch-failure message.
            raise

        except RateLimitError:
            if attempt == max_retries - 1:
                raise
            time.sleep(backoff)
            backoff *= 2

        except Exception as e:
            raise RuntimeError(
                f"Embedding failed on batch {batch_index}: {e}"
            ) from e

    # Unreachable but satisfies the type checker
    raise RuntimeError(f"Embedding failed after {max_retries} retries on batch {batch_index}")
