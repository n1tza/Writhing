-- Private bucket for uploaded PDFs. Objects are keyed <user_id>/<uuid>-<name>,
-- so the first path segment is the owner and the policies below can scope on it
-- without a lookup.
insert into storage.buckets (id, name, public)
values ('source-pdfs', 'source-pdfs', false)
on conflict (id) do nothing;

create policy "users can upload their own source pdfs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'source-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can read their own source pdfs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'source-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can delete their own source pdfs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'source-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- One bibliography entry per source. The worker relies on this to upsert its
-- parsed metadata onto whatever the user typed at upload time instead of
-- inserting a second, competing row.
alter table bibliography_items
  add constraint bibliography_items_source_id_key unique (source_id);

-- The user fills these in at upload; the worker may later fill blanks from
-- parsed metadata, but must never overwrite them.
grant insert, update on bibliography_items to authenticated;

-- 004 gave these tables read-only access. The upload dialog writes bibliography
-- metadata, and removing a source has to clear the evidence derived from it, so
-- both need full access scoped to the owning source.
create policy "users can manage bibliography for their own sources"
  on bibliography_items for all
  using (
    exists (
      select 1 from source_documents s
      where s.id = bibliography_items.source_id
        and s.user_id = auth.uid()
    )
  );

create policy "users can delete evidence from their own sources"
  on evidence_units for delete
  using (
    exists (
      select 1 from source_documents s
      where s.id = evidence_units.source_id
        and s.user_id = auth.uid()
    )
  );

grant delete on evidence_units to authenticated;
grant delete on bibliography_items to authenticated;
