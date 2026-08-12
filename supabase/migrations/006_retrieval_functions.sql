-- Vector legs of hybrid retrieval. The keyword leg goes through PostgREST
-- directly; only the distance search needs a function, since pgvector's <=>
-- operator is not expressible through the REST filter syntax.

create or replace function match_evidence_units(
  query_embedding vector(1536),
  source_ids uuid[],
  match_count int
)
returns table (
  id uuid,
  source_id uuid,
  text text,
  page_start int,
  page_end int,
  section_title text,
  section_path text[],
  distance float
)
language sql stable as $$
  select
    id,
    source_id,
    text,
    page_start,
    page_end,
    section_title,
    section_path,
    embedding <=> query_embedding as distance
  from evidence_units
  where (source_ids is null or source_id = any(source_ids))
  order by distance
  limit match_count;
$$;

create or replace function match_document_blocks(
  query_embedding vector(1536),
  p_document_id uuid,
  match_count int
)
returns table (
  id uuid,
  document_id uuid,
  block_type text,
  content text,
  parent_heading text,
  -- Quoted: `position` is a reserved keyword and is rejected unquoted in a
  -- function signature. The exposed column name is unchanged.
  "position" int,
  distance float
)
language sql stable as $$
  select
    id,
    document_id,
    block_type,
    content,
    parent_heading,
    "position",
    embedding <=> query_embedding as distance
  from document_blocks
  where document_id = p_document_id
    and embedding is not null
  order by distance
  limit match_count;
$$;
