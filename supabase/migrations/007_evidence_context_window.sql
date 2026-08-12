-- Small-to-big retrieval: match on a ~140-token passage for citation precision,
-- but give the model that passage plus its neighbours to read. Roughly one
-- chunk in nine opens with a reference to something in the preceding chunk
-- ("Such societies need...", "This distinction..."), which is unanswerable when
-- the passage is retrieved alone.

-- Position of a chunk within its source, in document order.
--
-- Nullable because it cannot be backfilled: a bulk insert stamps every row with
-- the same now(), so created_at does not recover insertion order, and nothing
-- else in the row encodes it. Sources processed before this migration keep null
-- and simply do not expand until they are reprocessed.
alter table evidence_units
  add column chunk_index int;

-- Nulls are distinct in Postgres, so pre-existing rows do not collide.
create unique index if not exists evidence_units_source_chunk_idx
  on evidence_units (source_id, chunk_index);

/*
 * Expand each anchor chunk to the window of chunks around it.
 *
 * Bounded to the anchor's own section: a window that crosses a section boundary
 * pulls in a different argument, which is worse than not expanding at all. A
 * single-chunk section therefore expands to itself, which is the right failure.
 *
 * Takes all anchors at once so expansion costs one round trip regardless of
 * topK.
 */
create or replace function expand_evidence_context(
  anchor_ids uuid[],
  radius int default 1
)
returns table (
  anchor_id uuid,
  context text,
  context_page_start int,
  context_page_end int,
  chunk_count int
)
language sql stable as $$
  select
    a.id,
    string_agg(n.text, E'\n\n' order by n.chunk_index),
    min(n.page_start),
    max(n.page_end),
    count(*)::int
  from evidence_units a
  join evidence_units n
    on n.source_id = a.source_id
   and n.chunk_index between a.chunk_index - radius and a.chunk_index + radius
   and n.section_title is not distinct from a.section_title
  where a.id = any(anchor_ids)
    and a.chunk_index is not null
  group by a.id;
$$;
