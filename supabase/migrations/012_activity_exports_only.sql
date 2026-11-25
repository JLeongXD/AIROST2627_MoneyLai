-- Apply after 010, or after the retired 011_procurement_exports.sql.
-- Keeps historical procurement data; disables its endpoints and budget guards.
begin;

drop trigger if exists guard_purchase_activity on public.activities;
drop trigger if exists guard_purchase_claim on public.claims;
do $$
declare f record; t text;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'ml\_%purchase%' escape '\' or p.proname='ml_activity_budgets')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
  foreach t in array array['purchase_requests','purchase_events'] loop
    if to_regclass('public.'||t) is not null then
      execute format('revoke all on table public.%I from public,anon,authenticated',t);
    end if;
  end loop;
end $$;

-- Restore the original budget model: only approved/paid claims consume budget.
create or replace function public.ml_activity_summary() returns table(
  id uuid,name text,description text,budget numeric,event_date date,status text,
  approved_spend numeric,pending_amount numeric,paid_amount numeric,remaining_budget numeric,unpaid_amount numeric)
language plpgsql stable security definer set search_path='' as $$
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

-- IF NOT EXISTS preserves claim numbers already assigned by old 011.
alter table public.claims add column if not exists claim_number bigint generated always as identity;
create unique index if not exists claims_export_number_unique on public.claims(claim_number);

create or replace function public.ml_activity_export(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); fiscal boolean; a jsonb;
begin
  if not exists(select 1 from public.profiles where id=u and role in ('treasurer','president')) then
    raise exception 'Only Treasurer or President can export an activity.';
  end if;
  fiscal:=public.ml_is_treasurer();
  select to_jsonb(s) into a from public.ml_activity_summary() s where s.id=p_activity_id;
  if a is null then raise exception 'Activity not found.'; end if;
  if (select count(*) from public.claims where activity_id=p_activity_id and status<>'draft')>1000 then
    raise exception 'This activity exceeds the export limit of 1000 claims.';
  end if;
  return jsonb_build_object(
    'generated_at',now(),'scope',case when fiscal then 'treasurer_evidence' else 'president_summary' end,
    'activity',a,
    'claims',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'code','ML-'||lpad(c.claim_number::text,greatest(6,length(c.claim_number::text)),'0'),
      'claimant_name',p.display_name,'amount',c.amount,'description',c.description,
      'status',c.status,'submitted_at',c.submitted_at,'category',c.category,'purchase_date',c.purchase_date
    ) order by c.claim_number) from public.claims c join public.profiles p on p.id=c.claimant_id
      where c.activity_id=p_activity_id and c.status<>'draft'),'[]'::jsonb),
    'attachments',case when fiscal then coalesce((select jsonb_agg(jsonb_build_object(
      'claim_id',x.claim_id,'kind',x.kind,'storage_path',x.storage_path,'original_name',x.original_name,
      'mime_type',x.mime_type,'size_bytes',x.size_bytes) order by x.created_at,x.id)
      from public.attachments x join public.claims c on c.id=x.claim_id
      where c.activity_id=p_activity_id and c.status<>'draft'),'[]'::jsonb) else '[]'::jsonb end,
    'payments',case when fiscal then coalesce((select jsonb_agg(jsonb_build_object(
      'claim_id',x.claim_id,'paid_on',x.paid_on,'reference',x.reference,'amount',x.amount,'proof_path',x.proof_path)
      order by x.created_at,x.id) from public.payments x join public.claims c on c.id=x.claim_id
      where c.activity_id=p_activity_id and c.status<>'draft'),'[]'::jsonb) else '[]'::jsonb end,
    'events',case when fiscal then coalesce((select jsonb_agg(jsonb_build_object(
      'claim_id',x.claim_id,'event_type',x.event_type,'note',x.note,'created_at',x.created_at,'actor',p.display_name)
      order by x.created_at,x.id) from public.claim_events x join public.claims c on c.id=x.claim_id
      join public.profiles p on p.id=x.actor_id
      where c.activity_id=p_activity_id and c.status<>'draft'),'[]'::jsonb) else '[]'::jsonb end,
    'activity_events',case when fiscal then coalesce((select jsonb_agg(jsonb_build_object(
      'old_budget',x.old_budget,'new_budget',x.new_budget,'note',x.note,'created_at',x.created_at,'actor',p.display_name)
      order by x.created_at,x.id) from public.activity_events x join public.profiles p on p.id=x.actor_id
      where x.activity_id=p_activity_id),'[]'::jsonb) else '[]'::jsonb end
  );
end; $$;
revoke all on function public.ml_activity_export(uuid) from public,anon,authenticated;
grant execute on function public.ml_activity_export(uuid) to authenticated;

-- Short-lived download links; files are deleted by the client after downloading.
-- Failed downloads are cleaned on the next export by the same user (after 1 hour).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('activity-exports','activity-exports',false,62914560,array['application/zip'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists activity_export_upload on storage.objects;
drop policy if exists activity_export_read on storage.objects;
drop policy if exists activity_export_delete on storage.objects;
create policy activity_export_upload on storage.objects for insert to authenticated
with check(bucket_id='activity-exports' and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.profiles where id=auth.uid() and role in ('treasurer','president')));
create policy activity_export_read on storage.objects for select to authenticated
using(bucket_id='activity-exports' and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.profiles where id=auth.uid() and role in ('treasurer','president')));
create policy activity_export_delete on storage.objects for delete to authenticated
using(bucket_id='activity-exports' and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.profiles where id=auth.uid() and role in ('treasurer','president')));
commit;
