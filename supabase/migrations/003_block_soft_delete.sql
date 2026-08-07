-- Blocks are never hard-deleted. Undo restores a ProseMirror node with its
-- original attributes, so a deleted block comes back under the same blockId --
-- as does cut-and-paste reordering, since the clipboard HTML carries
-- data-block-id. Hard-deleting would take citation_bindings with it (the FK is
-- NO ACTION and block_id is NOT NULL), losing the user's citations for what
-- they experienced as an undo or a move.
alter table document_blocks
  add column deleted_at timestamptz;

-- Every read path filters on live blocks for one document.
create index if not exists document_blocks_live_idx
  on document_blocks (document_id, position)
  where deleted_at is null;

/*
 * Reconcile a document's blocks against the editor's current contents.
 *
 * Upserts everything in p_blocks (clearing deleted_at, so an undone block is
 * resurrected rather than duplicated) and soft-deletes any live row that is no
 * longer present. Both statements run in one call so the table is never briefly
 * inconsistent, and so a large document does not have to send every uuid as a
 * URL filter.
 *
 * SECURITY INVOKER: RLS on document_blocks enforces ownership, exactly as it
 * does for the direct upsert this replaces.
 */
create or replace function save_document_blocks(
  p_document_id uuid,
  p_version_id uuid,
  p_blocks jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into document_blocks (
    id, document_id, version_id, block_type, content,
    parent_heading, "position", updated_at, deleted_at
  )
  select
    (b->>'id')::uuid,
    p_document_id,
    p_version_id,
    b->>'block_type',
    b->>'content',
    b->>'parent_heading',
    (b->>'position')::integer,
    now(),
    null
  from jsonb_array_elements(p_blocks) as b
  on conflict (id) do update set
    version_id     = excluded.version_id,
    block_type     = excluded.block_type,
    content        = excluded.content,
    parent_heading = excluded.parent_heading,
    "position"     = excluded."position",
    updated_at     = now(),
    deleted_at     = null;

  -- not exists rather than not in: the latter returns no rows if the payload
  -- ever contains a null id, silently skipping every soft delete.
  update document_blocks
  set deleted_at = now(),
      updated_at = now()
  where document_id = p_document_id
    and deleted_at is null
    and not exists (
      select 1
      from jsonb_array_elements(p_blocks) as b
      where (b->>'id')::uuid = document_blocks.id
    );
end;
$$;

grant execute on function save_document_blocks(uuid, uuid, jsonb) to authenticated;
