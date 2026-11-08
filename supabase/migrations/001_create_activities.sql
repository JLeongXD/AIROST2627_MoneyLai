create table public.activities (
  id uuid primary key default gen_random_uuid(),

  name text not null
    check (char_length(trim(name)) > 0),

  description text,

  budget numeric(12, 2) not null
    check (budget >= 0),

  status text not null default 'active'
    check (status in ('active', 'closed')),

  created_at timestamptz not null default now()
);

alter table public.activities
enable row level security;