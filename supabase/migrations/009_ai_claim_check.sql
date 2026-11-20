-- Run once after 008. AI reports are advisory and never change claim status.
begin;
create table public.ai_claim_checks (
 id uuid primary key default gen_random_uuid(),
 claim_id uuid references public.claims(id) on delete set null,
 requested_by uuid not null references public.profiles(id),
 input_signature text not null,
 status text not null default 'running' check(status in ('running','complete','failed')),
 result jsonb, model text not null,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create index on public.ai_claim_checks(claim_id,created_at desc);
create index on public.ai_claim_checks(requested_by,created_at desc);
alter table public.ai_claim_checks enable row level security;
revoke all on public.ai_claim_checks from anon,authenticated;
grant select on public.ai_claim_checks to authenticated;
grant all on public.ai_claim_checks to service_role;
create policy ai_check_read on public.ai_claim_checks for select to authenticated
using(exists(select 1 from public.claims c where c.id=claim_id and (c.claimant_id=auth.uid() or public.ml_is_treasurer())));

-- Called ONLY by the server after validating the real user's session.
create function public.ml_begin_ai_check(p_user uuid,p_claim uuid,p_signature text,p_model text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.claims; rid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('moneylai-ai-user-'||p_user::text,0));
 select * into c from public.claims where id=p_claim for update;
 if not found or not (c.claimant_id=p_user or exists(select 1 from public.profiles where id=p_user and role='treasurer')) then
  raise exception 'Claim access denied.';
 end if;
 if c.status not in ('draft','submitted','rejected') then raise exception 'AI checks are available before approval.'; end if;
 if exists(select 1 from public.ai_claim_checks where claim_id=p_claim and status='running' and created_at>now()-interval '3 minutes') then
  raise exception 'A check is already running. Please wait a few minutes.';
 end if;
 if exists(select 1 from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '30 seconds') then
  raise exception 'Please wait 30 seconds before another check.';
 end if;
 if (select count(*) from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '24 hours')>=20 then
  raise exception 'Daily AI check limit reached (20 checks per user).';
 end if;
 update public.ai_claim_checks set status='failed',finished_at=now() where claim_id=p_claim and status='running';
 insert into public.ai_claim_checks(claim_id,requested_by,input_signature,model) values(p_claim,p_user,p_signature,p_model) returning id into rid;
 return rid;
end; $$;
revoke all on function public.ml_begin_ai_check(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ml_begin_ai_check(uuid,uuid,text,text) to service_role;
commit;
