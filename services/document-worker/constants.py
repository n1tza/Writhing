EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
EMBEDDING_BATCH_SIZE = 100
MIN_CHUNK_TOKENS = 60
MAX_CHUNK_TOKENS = 350

# Docling element labels that establish section context but are not themselves
# quotable evidence. Their text is carried as section_title metadata instead.
HEADING_LABELS = frozenset({"title", "section_header"})

FOOTNOTE_LABEL = "footnote"

# Applied to footnotes that turn out to be pure reference apparatus. They are
# labelled rather than discarded: dropping one that was actually substantive
# loses evidence irreversibly, and these entries are the only available raw
# material for bibliography extraction, since Docling exposes no document
# metadata. Downstream should skip embedding them and exclude them from
# retrieval -- see EVIDENCE_LABELS.
REFERENCE_LABEL = "reference"

# A footnote is kept as evidence only if this much prose survives after its
# bibliographic apparatus is stripped. Set deliberately low: dropping a
# substantive note loses evidence permanently, while keeping a reference note
# only adds retrievable noise, so the rule is biased toward keeping.
MIN_FOOTNOTE_PROSE_TOKENS = 40

# Chunk labels that belong in the retrievable evidence pool. Reference apparatus
# is stored for provenance and bibliography extraction but must not be embedded
# or retrieved -- the AI cannot cite "Ibid., p. 27" as support for a claim.
EVIDENCE_LABELS = frozenset({"text", "list_item", "footnote", "caption"})
