-- Extensions
create extension if not exists vector;

-- Documents
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null default 'Untitled',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents not null,
  full_json jsonb not null,
  version_number integer not null,
  created_at timestamptz default now()
);

create table document_blocks (
  id uuid primary key,
  document_id uuid references documents not null,
  version_id uuid references document_versions,
  block_type text not null,
  content text not null,
  parent_heading text,
  position integer not null,
  embedding vector(1536),
  updated_at timestamptz default now()
);

-- Sources
create table source_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  document_id uuid references documents,
  filename text not null,
  storage_path text not null,
  status text not null default 'uploaded',
  error_message text,
  created_at timestamptz default now()
);

create table bibliography_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references source_documents not null,
  authors text[],
  title text,
  year integer,
  journal text,
  publisher text,
  doi text,
  url text,
  csl_json jsonb
);

create table evidence_units (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references source_documents not null,
  text text not null,
  text_hash text not null,
  page_start integer,
  page_end integer,
  section_title text,
  section_path text[],
  char_start integer,
  char_end integer,
  embedding vector(1536),
  created_at timestamptz default now()
);

create index on evidence_units
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index on evidence_units
  using gin (to_tsvector('english', text));

-- Citations
create table citation_bindings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents not null,
  block_id uuid references document_blocks not null,
  evidence_unit_id uuid references evidence_units not null,
  bibliography_item_id uuid references bibliography_items not null,
  status text not null default 'active',
  created_at timestamptz default now()
);

-- AI observability
create table generation_runs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents not null,
  user_id uuid references auth.users not null,
  action text not null,
  instruction text,
  model text not null,
  prompt_tokens integer,
  completion_tokens integer,
  selected_block_ids uuid[],
  retrieved_evidence_ids uuid[],
  proposed_patch jsonb,
  accepted boolean,
  created_at timestamptz default now()
);

-- RLS
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table document_blocks enable row level security;
alter table source_documents enable row level security;
alter table bibliography_items enable row level security;
alter table evidence_units enable row level security;
alter table citation_bindings enable row level security;
alter table generation_runs enable row level security;

create policy "users can manage their own documents"
  on documents for all
  using (auth.uid() = user_id);

create policy "users can manage their own sources"
  on source_documents for all
  using (auth.uid() = user_id);

create policy "users can manage their own generation runs"
  on generation_runs for all
  using (auth.uid() = user_id);
