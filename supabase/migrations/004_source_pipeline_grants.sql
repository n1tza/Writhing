-- Same gap 002 fixed for the document tables: default privileges give roles
-- only TRUNCATE/REFERENCES/TRIGGER on newly created tables, so every request is
-- rejected with "permission denied for table" before RLS is consulted.
--
-- The document worker runs server-side under the service role, which bypasses
-- RLS but still needs table privileges.
grant select, insert, update, delete
  on source_documents, evidence_units, bibliography_items
  to service_role;

-- The app reads and writes its own sources through PostgREST; the existing
-- "users can manage their own sources" policy on source_documents scopes it.
grant select, insert, update, delete
  on source_documents
  to authenticated;

-- Evidence lookup during retrieval. Ownership is inherited from the uploaded
-- source; 001 enabled RLS on these tables without defining any policy, which
-- denies everything.
create policy "users can read evidence from their own sources"
  on evidence_units for select
  using (
    exists (
      select 1 from source_documents s
      where s.id = evidence_units.source_id
        and s.user_id = auth.uid()
    )
  );

create policy "users can read bibliography for their own sources"
  on bibliography_items for select
  using (
    exists (
      select 1 from source_documents s
      where s.id = bibliography_items.source_id
        and s.user_id = auth.uid()
    )
  );

grant select on evidence_units, bibliography_items to authenticated;

-- Evidence is always fetched, and cleared on reprocess, one source at a time.
create index if not exists evidence_units_source_id_idx
  on evidence_units (source_id);

create index if not exists bibliography_items_source_id_idx
  on bibliography_items (source_id);
