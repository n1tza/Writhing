-- Fifth instance of the same bug: a table gets created, RLS gets a policy, and
-- the request fails with "permission denied for table" because no DML grant was
-- ever issued. 002 covered the document tables for authenticated, 004 the
-- source tables for service_role, 008 generation_runs -- but the retrievers run
-- as service_role and read document_blocks, which nothing had granted.
--
-- Granted table by table rather than with a loop so the set is auditable.
grant select, insert, update, delete on
  documents,
  document_versions,
  document_blocks,
  source_documents,
  evidence_units,
  bibliography_items,
  citation_bindings,
  generation_runs
to service_role;

-- And stop it happening a sixth time. Default privileges apply to tables
-- created later by this role, which is the role migrations run as -- so a new
-- table in a future migration arrives with service_role access already granted.
-- RLS still governs every other role; this only covers the server-side key.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
