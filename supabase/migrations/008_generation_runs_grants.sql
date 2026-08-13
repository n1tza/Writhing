-- Same privilege gap as 002/004/005: 001 enabled RLS on generation_runs and
-- defined an ownership policy, but never granted DML, so every insert is
-- rejected with "permission denied for table" before RLS is consulted.
--
-- The grounded chat route logs one row per answer under the caller's own
-- session, so the grant is to authenticated (not service_role) and the existing
-- "users can manage their own generation runs" policy scopes it.
grant select, insert, update on generation_runs to authenticated;

-- Runs are read back per document when reviewing what the AI cited.
create index if not exists generation_runs_document_id_idx
  on generation_runs (document_id, created_at desc);
