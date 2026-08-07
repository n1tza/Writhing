-- Autosave stamps version_number with Date.now(), which is ~1.75e12 and
-- overflows int4 (max 2147483647).
alter table document_versions
  alter column version_number type bigint;

-- 001 enabled RLS on document_versions and document_blocks but defined no
-- policies, which denies every read and write. Ownership is inherited from the
-- parent document.
create policy "users can manage versions of their own documents"
  on document_versions for all
  using (
    exists (
      select 1 from documents d
      where d.id = document_versions.document_id
        and d.user_id = auth.uid()
    )
  );

create policy "users can manage blocks of their own documents"
  on document_blocks for all
  using (
    exists (
      select 1 from documents d
      where d.id = document_blocks.document_id
        and d.user_id = auth.uid()
    )
  );

-- Default privileges give anon/authenticated only TRUNCATE/REFERENCES/TRIGGER on
-- newly created tables, so without these grants every request is rejected with
-- "permission denied for table" before RLS is ever consulted.
grant select, insert, update, delete
  on documents, document_versions, document_blocks
  to authenticated;

-- Blocks are always fetched, and reconciled on save, one document at a time.
create index if not exists document_blocks_document_id_position_idx
  on document_blocks (document_id, position);
