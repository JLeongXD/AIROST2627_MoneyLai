create table public.claims (
  id uuid primary key default gen_random_uuid(),

  claimant_id uuid not null
    default auth.uid()
    references auth.users(id),

  activity_id uuid not null
    references public.activities(id),

  amount numeric(12, 2) not null
    check (amount > 0),

  description text not null
    check (char_length(trim(description)) between 1 and 500),

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'submitted',
        'approved',
        'rejected',
        'paid'
      )
    ),

  created_at timestamptz not null default now()
);

alter table public.claims enable row level security;

revoke all on table public.claims from anon, authenticated;

grant select on table public.claims to authenticated;

grant insert (
  activity_id,
  amount,
  description
) on table public.claims to authenticated;

create policy "Users can read their own claims"
on public.claims
for select
to authenticated
using (
  claimant_id = (select auth.uid())
);

create policy "Users can create their own drafts"
on public.claims
for insert
to authenticated
with check (
  claimant_id = (select auth.uid())
  and status = 'draft'
  and exists (
    select 1
    from public.activities
    where activities.id = claims.activity_id
      and activities.status = 'active'
  )
);

create index claims_claimant_id_idx
on public.claims (claimant_id);