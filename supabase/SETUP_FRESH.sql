-- NEW PROJECTS ONLY. Existing projects must use migration 006 only.

-- 001_create_activities.sql
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
-- 002_read_activities.sql
grant usage on schema public to authenticated;

grant select on table public.activities to authenticated;

create policy "Authenticated users can read activities"
on public.activities
for select
to authenticated
using (true);
-- 003_create_claims.sql
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
-- 004_edit_drafts.sql
grant update (amount, description)
on table public.claims
to authenticated;

create policy "Users can update their own drafts"
on public.claims
for update
to authenticated
using (
  claimant_id = (select auth.uid())
  and status = 'draft'
)
with check (
  claimant_id = (select auth.uid())
  and status = 'draft'
);
-- 005_delete_drafts.sql
grant delete on table public.claims to authenticated;

create policy "Users can delete their own drafts"
on public.claims
for delete
to authenticated
using (
  claimant_id = (select auth.uid())
  and status = 'draft'
);
-- 006_complete_workflow.sql
-- Run ONCE after 001-005, using Supabase SQL Editor as the project owner.
-- Preserves existing activities and claims. Replaces MoneyLai access policies.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null default 'Member',
  role text not null default 'member' check (role in ('member','treasurer')),
  created_at timestamptz not null default now()
);
insert into public.profiles(id,display_name)
select id, coalesce(nullif(raw_user_meta_data->>'display_name',''),split_part(email,'@',1),'Member')
from auth.users on conflict(id) do nothing;

create function public.ml_on_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),split_part(new.email,'@',1),'Member'));
  return new;
end; $$;
create trigger moneylai_user_created after insert on auth.users
for each row execute function public.ml_on_user_created();

alter table public.activities add column event_date date;
alter table public.activities add column created_by uuid references public.profiles(id);
alter table public.activities add column updated_at timestamptz not null default now();
alter table public.claims add constraint claims_claimant_profile_fkey foreign key(claimant_id) references public.profiles(id);
alter table public.claims add column purchase_date date;
alter table public.claims add column category text not null default 'Materials'
  check(category in ('Materials','Food & Drinks','Transport','Venue','Equipment','Other'));
alter table public.claims add column rejection_reason text;
alter table public.claims add column submitted_at timestamptz;
alter table public.claims add column reviewed_by uuid references public.profiles(id);
alter table public.claims add column reviewed_at timestamptz;
alter table public.claims add column paid_at timestamptz;
alter table public.claims add column updated_at timestamptz not null default now();

create table public.payout_details (
  user_id uuid primary key references public.profiles(id),
  recipient_name text not null check(length(trim(recipient_name)) between 1 and 100),
  provider_name text not null check(length(trim(provider_name)) between 1 and 100),
  account_number text not null check(length(trim(account_number)) between 3 and 50),
  updated_at timestamptz not null default now()
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id),
  kind text not null check(kind in ('receipt','supporting')),
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims(id),
  paid_by uuid not null references public.profiles(id),
  paid_on date not null,
  reference text not null,
  proof_path text not null unique,
  amount numeric(12,2) not null check(amount>0),
  recipient_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create table public.claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null,
  note text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id),
  actor_id uuid not null references public.profiles(id),
  old_budget numeric(12,2), new_budget numeric(12,2),
  note text not null,
  created_at timestamptz not null default now()
);
create index on public.attachments(claim_id);
create index on public.claim_events(claim_id,created_at);
create index on public.claims(activity_id,status);
create index on public.claims(status,submitted_at);

-- Internal helpers. They are not public mutation endpoints.
create function public.ml_require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or not exists(select 1 from public.profiles where id=u) then
    raise exception 'Please sign in with a configured MoneyLai account.';
  end if;
  return u;
end; $$;
create function public.ml_is_treasurer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='treasurer');
$$;
create function public.ml_lock_claim(p_claim_id uuid) returns public.claims
language plpgsql security definer set search_path = '' as $$
declare c public.claims; a uuid;
begin
  select activity_id into a from public.claims where id=p_claim_id;
  if not found then raise exception 'Claim not found.'; end if;
  -- Every financial mutation locks activity before claim.
  perform 1 from public.activities where id=a for update;
  select * into c from public.claims where id=p_claim_id for update;
  if not found then raise exception 'Claim not found.'; end if;
  return c;
end; $$;
create function public.ml_event(p_claim_id uuid,p_type text,p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.claim_events(claim_id,actor_id,event_type,note,snapshot)
  select id,auth.uid(),p_type,p_note,jsonb_build_object(
    'amount',amount,'description',description,'category',category,
    'actor_name',(select display_name from public.profiles where id=auth.uid()),
    'purchase_date',purchase_date,'status',status,
    'attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'path',a.storage_path)),'[]'::jsonb)
                   from public.attachments a where a.claim_id=c.id))
  from public.claims c where id=p_claim_id;
$$;

-- Table grants + RLS. Writes go through validated RPC functions below.
do $$ declare p record; t text; begin
  foreach t in array array['activities','claims','profiles','payout_details','attachments','payments','claim_events','activity_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
  end loop;
end; $$;
grant usage on schema public to authenticated;
create policy activity_read on public.activities for select to authenticated using(true);
create policy profile_read on public.profiles for select to authenticated
  using(id=auth.uid() or public.ml_is_treasurer());
create policy payout_read on public.payout_details for select to authenticated
  using(user_id=auth.uid() or public.ml_is_treasurer());
create policy claim_read on public.claims for select to authenticated
  using(claimant_id=auth.uid() or public.ml_is_treasurer());
create policy attachment_read on public.attachments for select to authenticated
  using(exists(select 1 from public.claims c where c.id=claim_id and (c.claimant_id=auth.uid() or public.ml_is_treasurer())));
create policy payment_read on public.payments for select to authenticated
  using(exists(select 1 from public.claims c where c.id=claim_id and (c.claimant_id=auth.uid() or public.ml_is_treasurer())));
create policy event_read on public.claim_events for select to authenticated
  using(exists(select 1 from public.claims c where c.id=claim_id and (c.claimant_id=auth.uid() or public.ml_is_treasurer())));
create policy activity_event_read on public.activity_events for select to authenticated using(public.ml_is_treasurer());

create function public.ml_save_profile(p_display_name text,p_recipient text,p_provider text,p_account text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user();
begin
  if length(trim(p_display_name)) not between 1 and 100 or p_display_name is null then
    raise exception 'Enter a display name of 1 to 100 characters.';
  end if;
  update public.profiles set display_name=trim(p_display_name) where id=u;
  if nullif(trim(p_recipient),'') is not null or nullif(trim(p_provider),'') is not null or nullif(trim(p_account),'') is not null then
    insert into public.payout_details(user_id,recipient_name,provider_name,account_number)
    values(u,trim(p_recipient),trim(p_provider),trim(p_account))
    on conflict(user_id) do update set recipient_name=excluded.recipient_name,
      provider_name=excluded.provider_name,account_number=excluded.account_number,updated_at=now();
  end if;
end; $$;

create function public.ml_save_claim(p_claim_id uuid,p_activity_id uuid,p_amount numeric,p_description text,p_purchase_date date,p_category text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims; result uuid;
begin
  if p_amount is null or p_amount<=0 or p_amount>9999999999.99 or p_amount<>round(p_amount,2) then
    raise exception 'Enter a positive amount with at most two decimal places.';
  end if;
  if p_description is null or length(trim(p_description)) not between 1 and 500 then
    raise exception 'Description must contain 1 to 500 characters.';
  end if;
  if p_category is null or p_category not in ('Materials','Food & Drinks','Transport','Venue','Equipment','Other') then
    raise exception 'Select a valid expense category.';
  end if;
  if p_purchase_date > (now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Purchase date cannot be in the future.'; end if;
  if p_claim_id is null then
    perform 1 from public.activities where id=p_activity_id and status='active' for update;
    if not found then raise exception 'Select an active activity.'; end if;
    insert into public.claims(claimant_id,activity_id,amount,description,purchase_date,category)
    values(u,p_activity_id,p_amount,trim(p_description),p_purchase_date,p_category) returning id into result;
  else
    c := public.ml_lock_claim(p_claim_id);
    if c.claimant_id<>u or c.status<>'draft' then raise exception 'Only your own draft can be edited.'; end if;
    if c.activity_id<>p_activity_id then raise exception 'An existing claim cannot be moved to another activity.'; end if;
    if not exists(select 1 from public.activities where id=c.activity_id and status='active') then raise exception 'This activity is closed.'; end if;
    update public.claims set amount=p_amount,description=trim(p_description),purchase_date=p_purchase_date,
      category=p_category,updated_at=now() where id=c.id;
    result:=c.id;
  end if;
  return result;
end; $$;

create function public.ml_delete_claim(p_claim_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims;
begin
  c:=public.ml_lock_claim(p_claim_id);
  if c.claimant_id<>u or c.status<>'draft' then raise exception 'Only your own draft can be deleted.'; end if;
  if exists(select 1 from public.claim_events where claim_id=c.id and event_type='submitted') then
    raise exception 'Previously submitted claims must be retained for history.';
  end if;
  if exists(select 1 from public.attachments where claim_id=c.id) then raise exception 'Open the claim and remove its attachments before deleting it.'; end if;
  delete from public.claims where id=c.id;
end; $$;

create function public.ml_submit_claim(p_claim_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims;
begin
  c:=public.ml_lock_claim(p_claim_id);
  if c.claimant_id<>u or c.status<>'draft' then raise exception 'Only your own draft can be submitted.'; end if;
  if not exists(select 1 from public.activities where id=c.activity_id and status='active') then raise exception 'This activity is closed.'; end if;
  if c.purchase_date is null or c.purchase_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Add a valid purchase date before submitting.'; end if;
  if not exists(select 1 from public.payout_details where user_id=u) then raise exception 'Add your payout details in Profile before submitting.'; end if;
  if not exists(select 1 from public.attachments a join storage.objects o on o.name=a.storage_path and o.bucket_id='receipts'
    where a.claim_id=c.id and a.kind='receipt') then raise exception 'Upload at least one receipt before submitting.'; end if;
  update public.claims set status='submitted',submitted_at=now(),rejection_reason=null,updated_at=now() where id=c.id;
  perform public.ml_event(c.id,'submitted','Claim submitted for review.');
end; $$;

create function public.ml_return_to_draft(p_claim_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims;
begin
  c:=public.ml_lock_claim(p_claim_id);
  if c.claimant_id<>u or c.status not in ('submitted','rejected') then raise exception 'This claim cannot be returned to draft.'; end if;
  update public.claims set status='draft',updated_at=now() where id=c.id;
  perform public.ml_event(c.id,case when c.status='rejected' then 'revision_started' else 'withdrawn' end,'Returned to draft.');
end; $$;

create function public.ml_review_claim(p_claim_id uuid,p_decision text,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims; allocation numeric; committed numeric;
begin
  if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
  c:=public.ml_lock_claim(p_claim_id);
  if c.claimant_id=u then raise exception 'Another treasurer must review your claim.'; end if;
  if c.status<>'submitted' then raise exception 'This claim is no longer awaiting review.'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Invalid review decision.'; end if;
  if p_decision='rejected' and (p_reason is null or length(trim(p_reason)) not between 3 and 1000) then raise exception 'Provide a rejection reason of 3 to 1000 characters.'; end if;
  if p_decision='approved' then
    select budget into allocation from public.activities where id=c.activity_id and status='active';
    if not found then raise exception 'This activity is closed.'; end if;
    select coalesce(sum(amount),0) into committed from public.claims where activity_id=c.activity_id and status in ('approved','paid');
    if c.amount>allocation-committed then raise exception 'Insufficient budget. Adjust the activity budget before approving.'; end if;
  end if;
  update public.claims set status=p_decision,reviewed_by=u,reviewed_at=now(),
    rejection_reason=case when p_decision='rejected' then trim(p_reason) else null end,updated_at=now() where id=c.id;
  perform public.ml_event(c.id,p_decision,case when p_decision='rejected' then trim(p_reason) else 'Approved; awaiting external payment.' end);
end; $$;

create function public.ml_revoke_approval(p_claim_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims;
begin
  if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
  c:=public.ml_lock_claim(p_claim_id);
  if c.claimant_id=u or c.status<>'approved' then raise exception 'Only another treasurer can revoke an unpaid approval.'; end if;
  if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'Provide a reason of 3 to 1000 characters.'; end if;
  if exists(select 1 from public.payments where claim_id=c.id) then raise exception 'A payment has already been recorded.'; end if;
  update public.claims set status='submitted',reviewed_by=null,reviewed_at=null,updated_at=now() where id=c.id;
  perform public.ml_event(c.id,'approval_revoked',trim(p_reason));
end; $$;

create function public.ml_save_activity(p_activity_id uuid,p_name text,p_description text,p_budget numeric,p_event_date date,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); a public.activities; result uuid; committed numeric;
begin
  if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Activity name must contain 1 to 120 characters.'; end if;
  if p_budget is null or p_budget<0 or p_budget>9999999999.99 or p_budget<>round(p_budget,2) then raise exception 'Enter a valid budget with at most two decimal places.'; end if;
  if length(coalesce(p_description,''))>2000 then raise exception 'Activity description is too long.'; end if;
  if p_activity_id is null then
    insert into public.activities(name,description,budget,event_date,created_by)
    values(trim(p_name),trim(p_description),p_budget,p_event_date,u) returning id into result;
    insert into public.activity_events(activity_id,actor_id,new_budget,note) values(result,u,p_budget,'Activity created.');
  else
    select * into a from public.activities where id=p_activity_id for update;
    if not found or a.status<>'active' then raise exception 'Only active activities can be edited.'; end if;
    if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'Provide an update reason of 3 to 1000 characters.'; end if;
    select coalesce(sum(amount),0) into committed from public.claims where activity_id=a.id and status in ('approved','paid');
    if p_budget<committed then raise exception 'Budget cannot be lower than approved expenditure.'; end if;
    update public.activities set name=trim(p_name),description=trim(p_description),budget=p_budget,event_date=p_event_date,updated_at=now() where id=a.id;
    insert into public.activity_events(activity_id,actor_id,old_budget,new_budget,note) values(a.id,u,a.budget,p_budget,trim(p_reason));
    result:=a.id;
  end if;
  return result;
end; $$;

create function public.ml_set_activity_status(p_activity_id uuid,p_status text,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); a public.activities;
begin
  if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
  if p_status is null or p_status not in ('active','closed') or p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'Select a valid status and provide a reason.'; end if;
  select * into a from public.activities where id=p_activity_id for update;
  if not found then raise exception 'Activity not found.'; end if;
  if p_status='closed' and exists(select 1 from public.claims where activity_id=a.id and status in ('submitted','approved')) then raise exception 'Resolve pending reviews and payments before closing.'; end if;
  update public.activities set status=p_status,updated_at=now() where id=a.id;
  insert into public.activity_events(activity_id,actor_id,old_budget,new_budget,note) values(a.id,u,a.budget,a.budget,p_status||': '||trim(p_reason));
end; $$;

create function public.ml_activity_summary() returns table(
  id uuid,name text,description text,budget numeric,event_date date,status text,
  approved_spend numeric,pending_amount numeric,paid_amount numeric,remaining_budget numeric,unpaid_amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.ml_require_user();
  return query select a.id,a.name,a.description,a.budget,a.event_date,a.status,
    coalesce(s.committed,0),coalesce(s.pending,0),coalesce(s.paid,0),a.budget-coalesce(s.committed,0),coalesce(s.unpaid,0)
  from public.activities a left join lateral (
    select sum(c.amount) filter(where c.status in ('approved','paid')) committed,
      sum(c.amount) filter(where c.status='submitted') pending,
      sum(c.amount) filter(where c.status='paid') paid,
      sum(c.amount) filter(where c.status='approved') unpaid
    from public.claims c where c.activity_id=a.id
  ) s on true order by a.created_at desc;
end; $$;

-- Private files. No public receipt URLs; no unrestricted client mutation.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipts','receipts',false,5242880,array['image/jpeg','image/png','application/pdf']),
      ('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy moneylai_receipt_upload on storage.objects for insert to authenticated
with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.claims c where c.id::text=(storage.foldername(name))[2] and c.claimant_id=auth.uid() and c.status='draft'));
create policy moneylai_receipt_read on storage.objects for select to authenticated
using(bucket_id='receipts' and (
  ((storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.claims c where c.id::text=(storage.foldername(name))[2] and c.claimant_id=auth.uid()))
  or (public.ml_is_treasurer() and exists(select 1 from public.attachments a where a.storage_path=name))));
create policy moneylai_receipt_delete on storage.objects for delete to authenticated
using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text
  and not exists(select 1 from public.attachments a where a.storage_path=name));
create policy moneylai_payment_upload on storage.objects for insert to authenticated
with check(bucket_id='payment-proofs' and public.ml_is_treasurer() and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.claims c where c.id::text=(storage.foldername(name))[2] and c.claimant_id<>auth.uid() and c.status='approved'));
create policy moneylai_payment_read on storage.objects for select to authenticated
using(bucket_id='payment-proofs' and (public.ml_is_treasurer() or exists(
  select 1 from public.payments p join public.claims c on c.id=p.claim_id where p.proof_path=name and c.claimant_id=auth.uid())));
create policy moneylai_payment_delete on storage.objects for delete to authenticated
using(bucket_id='payment-proofs' and public.ml_is_treasurer() and (storage.foldername(name))[1]=auth.uid()::text
  and not exists(select 1 from public.payments p where p.proof_path=name));

create function public.ml_register_attachment(p_claim_id uuid,p_path text,p_name text,p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims; meta jsonb; result uuid;
begin
  c:=public.ml_lock_claim(p_claim_id);
  if c.claimant_id<>u or c.status<>'draft' then raise exception 'Only the owner of a draft can upload attachments.'; end if;
  if p_kind is null or p_kind not in ('receipt','supporting') or p_name is null or length(p_name) not between 1 and 200 then raise exception 'Invalid attachment details.'; end if;
  if split_part(p_path,'/',1)<>u::text or split_part(p_path,'/',2)<>c.id::text then raise exception 'Invalid attachment path.'; end if;
  select metadata into meta from storage.objects where bucket_id='receipts' and name=p_path;
  if not found then raise exception 'Upload the file before registering it.'; end if;
  select id into result from public.attachments where storage_path=p_path and claim_id=c.id;
  if found then return result; end if;
  if (select count(*) from public.attachments where claim_id=c.id)>=5 then raise exception 'Maximum five attachments per claim.'; end if;
  insert into public.attachments(claim_id,kind,storage_path,original_name,mime_type,size_bytes,uploaded_by)
  values(c.id,p_kind,p_path,p_name,coalesce(meta->>'mimetype','application/octet-stream'),coalesce((meta->>'size')::bigint,0),u)
  returning id into result;
  return result;
end; $$;

create function public.ml_remove_attachment(p_attachment_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims; a public.attachments;
begin
  select * into a from public.attachments where id=p_attachment_id;
  if not found then raise exception 'Attachment not found.'; end if;
  c:=public.ml_lock_claim(a.claim_id);
  if c.claimant_id<>u or c.status<>'draft' then raise exception 'Only attachments on your own draft can be removed.'; end if;
  delete from public.attachments where id=a.id;
  return a.storage_path;
end; $$;

create function public.ml_record_payment(p_claim_id uuid,p_paid_on date,p_reference text,p_proof_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.ml_require_user(); c public.claims; recipient jsonb; result uuid;
begin
  if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
  c:=public.ml_lock_claim(p_claim_id);
  if c.claimant_id=u then raise exception 'Another treasurer must record your reimbursement.'; end if;
  select id into result from public.payments where claim_id=c.id;
  if found then return result; end if; -- safe retry, one payment per claim
  if c.status<>'approved' then raise exception 'Only approved claims can be reimbursed.'; end if;
  if p_paid_on is null or p_paid_on>(now() at time zone 'Asia/Kuala_Lumpur')::date or p_paid_on<c.purchase_date then raise exception 'Enter a valid payment date.'; end if;
  if p_reference is null or length(trim(p_reference)) not between 1 and 150 then raise exception 'Enter a payment reference of 1 to 150 characters.'; end if;
  if p_proof_path is null or split_part(p_proof_path,'/',1)<>u::text or split_part(p_proof_path,'/',2)<>c.id::text
     or not exists(select 1 from storage.objects where bucket_id='payment-proofs' and name=p_proof_path) then
    raise exception 'Upload payment proof first.';
  end if;
  select jsonb_build_object('recipient_name',recipient_name,'provider_name',provider_name,'account_number',account_number)
  into recipient from public.payout_details where user_id=c.claimant_id;
  if not found then raise exception 'The claimant must add payout details before payment.'; end if;
  insert into public.payments(claim_id,paid_by,paid_on,reference,proof_path,amount,recipient_snapshot)
  values(c.id,u,p_paid_on,trim(p_reference),p_proof_path,c.amount,recipient) returning id into result;
  update public.claims set status='paid',paid_at=now(),updated_at=now() where id=c.id;
  perform public.ml_event(c.id,'paid','External payment recorded. Reference: '||trim(p_reference));
  return result;
end; $$;

-- Revoke default PUBLIC execution and expose only intentional entry points.
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and left(p.proname,3)='ml_' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.sig);
    if f.proname in ('ml_is_treasurer','ml_save_profile','ml_save_claim','ml_delete_claim','ml_submit_claim',
      'ml_return_to_draft','ml_review_claim','ml_revoke_approval','ml_save_activity','ml_set_activity_status',
      'ml_activity_summary','ml_register_attachment','ml_remove_attachment','ml_record_payment') then
      execute format('grant execute on function %s to authenticated',f.sig);
    end if;
  end loop;
end; $$;
notify pgrst, 'reload schema';
commit;
