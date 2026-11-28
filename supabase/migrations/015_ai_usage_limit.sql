-- Run after 014. Raises the shared rolling AI allowance from 20 to 100 per user.
-- Keeps membership wrappers, private function permissions and the 30-second cooldown.
begin;
do $$ begin
 if to_regprocedure('public.ml_begin_ai_check_before_membership(uuid,uuid,text,text)') is null
 or to_regprocedure('public.ml_begin_receipt_read_before_membership(uuid,uuid,text)') is null then
  raise exception 'Apply migration 014_member_management.sql before migration 015.';
 end if;
end; $$;

create or replace function public.ml_begin_ai_check_before_membership(p_user uuid,p_claim uuid,p_signature text,p_model text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.claims; rid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('moneylai-ai-user-'||p_user::text,0));
 select * into c from public.claims where id=p_claim for update;
 if not found or not (c.claimant_id=p_user or exists(select 1 from public.profiles where id=p_user and role='treasurer')) then
  raise exception 'Claim access denied.';
 end if;
 if c.status not in ('draft','submitted','needs_info','rejected') then raise exception 'AI checks are available before approval.'; end if;
 if exists(select 1 from public.ai_claim_checks where claim_id=p_claim and status='running' and created_at>now()-interval '3 minutes') then
  raise exception 'A check is already running. Please wait a few minutes.';
 end if;
 if exists(select 1 from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '30 seconds') then
  raise exception 'Please wait 30 seconds before another check.';
 end if;
 if (select count(*) from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '24 hours')>=100 then
  raise exception 'Daily AI check limit reached (100 checks per user in the past 24 hours).';
 end if;
 update public.ai_claim_checks set status='failed',finished_at=now() where claim_id=p_claim and status='running';
 insert into public.ai_claim_checks(claim_id,requested_by,input_signature,model) values(p_claim,p_user,p_signature,p_model) returning id into rid;
 return rid;
end; $$;

create or replace function public.ml_begin_receipt_read_before_membership(p_user uuid,p_session uuid,p_model text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.receipt_drafts; rid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('moneylai-ai-user-'||p_user::text,0));
 select * into s from public.receipt_drafts where id=p_session for update;
 if not found or s.user_id<>p_user or s.claim_id is not null or s.expires_at<=now() then raise exception 'Receipt draft is unavailable or expired.'; end if;
 if s.status='complete' then raise exception 'Receipt is already read. Use its saved extraction.'; end if;
 if s.status='running' and exists(select 1 from public.ai_claim_checks where id=s.run_id and created_at>now()-interval '3 minutes') then raise exception 'A receipt reading is already running.'; end if;
 if exists(select 1 from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '30 seconds') then raise exception 'Please wait 30 seconds before another AI request.'; end if;
 if (select count(*) from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '24 hours')>=100 then raise exception 'Daily AI check limit reached (100 checks per user in the past 24 hours).'; end if;
 insert into public.ai_claim_checks(requested_by,input_signature,model) values(p_user,'receipt:'||s.id::text,p_model) returning id into rid;
 update public.receipt_drafts set status='running',run_id=rid,model=p_model where id=s.id;
 return rid;
end; $$;

revoke all on function public.ml_begin_ai_check_before_membership(uuid,uuid,text,text),
 public.ml_begin_receipt_read_before_membership(uuid,uuid,text) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
