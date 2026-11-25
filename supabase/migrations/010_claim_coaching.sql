-- Apply once after 009. Existing claims and audit records are preserved.
begin;
alter table public.claims drop constraint claims_status_check;
alter table public.claims add constraint claims_status_check check(status in ('draft','submitted','needs_info','approved','rejected','paid'));
alter table public.claims add column info_requested_at timestamptz;
create table public.claim_clarifications (
 id uuid primary key default gen_random_uuid(),
 claim_id uuid not null references public.claims(id) on delete cascade,
 requested_by uuid not null references public.profiles(id),
 question text not null check(length(trim(question)) between 3 and 1000),
 reply text check(length(trim(reply)) between 3 and 2000),
 requested_at timestamptz not null default now(), responded_at timestamptz
);
create unique index clarification_one_open on public.claim_clarifications(claim_id) where responded_at is null;
alter table public.claim_clarifications enable row level security;
revoke all on public.claim_clarifications from anon,authenticated;
grant select on public.claim_clarifications to authenticated;
create policy clarification_read on public.claim_clarifications for select to authenticated using(exists(
 select 1 from public.claims c where c.id=claim_id and (c.claimant_id=auth.uid() or public.ml_is_treasurer())));

create function public.ml_request_information(p_claim_id uuid,p_question text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); c public.claims;
begin
 if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
 c:=public.ml_lock_claim(p_claim_id);
 if c.claimant_id=u or c.status<>'submitted' then raise exception 'Only another member''s submitted claim can be queried.'; end if;
 if p_question is null or length(trim(p_question)) not between 3 and 1000 then raise exception 'Explain what is missing in 3 to 1000 characters.'; end if;
 insert into public.claim_clarifications(claim_id,requested_by,question) values(c.id,u,trim(p_question));
 update public.claims set status='needs_info',info_requested_at=now(),updated_at=now() where id=c.id;
 perform public.ml_event(c.id,'information_requested',trim(p_question));
end; $$;

create or replace function public.ml_return_to_draft(p_claim_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); c public.claims;
begin
 c:=public.ml_lock_claim(p_claim_id);
 if c.claimant_id<>u or c.status not in ('submitted','rejected','needs_info') then raise exception 'This claim cannot be returned to draft.'; end if;
 update public.claims set status='draft',updated_at=now() where id=c.id;
 perform public.ml_event(c.id,case when c.status='needs_info' then 'information_response_started' when c.status='rejected' then 'revision_started' else 'withdrawn' end,'Returned to draft.');
end; $$;

-- Guard the existing submit RPC too: users cannot bypass a requested reply.
create function public.ml_check_information_reply() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='submitted' and exists(select 1 from public.claim_clarifications where claim_id=new.id and responded_at is null) then
  raise exception 'Reply to the Treasurer''s request before resubmitting.';
 end if;
 return new;
end; $$;
create trigger claim_information_reply before update of status on public.claims for each row execute function public.ml_check_information_reply();
create function public.ml_reply_information(p_claim_id uuid,p_reply text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); c public.claims;
begin
 c:=public.ml_lock_claim(p_claim_id);
 if c.claimant_id<>u or c.status<>'draft' then raise exception 'Prepare your own draft before replying.'; end if;
 if p_reply is null or length(trim(p_reply)) not between 3 and 2000 then raise exception 'Explain your changes in 3 to 2000 characters.'; end if;
 update public.claim_clarifications set reply=trim(p_reply),responded_at=now() where claim_id=c.id and responded_at is null;
 if not found then raise exception 'No outstanding request.'; end if;
 perform public.ml_submit_claim(c.id);
 update public.claims set info_requested_at=null where id=c.id;
 perform public.ml_event(c.id,'information_supplied',trim(p_reply));
end; $$;

alter function public.ml_set_activity_status(uuid,text,text) rename to ml_set_activity_status_before_information;
revoke all on function public.ml_set_activity_status_before_information(uuid,text,text) from public,anon,authenticated;
create function public.ml_set_activity_status(p_activity_id uuid,p_status text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
 perform 1 from public.activities where id=p_activity_id for update;
 if p_status='closed' and exists(select 1 from public.claims where activity_id=p_activity_id and info_requested_at is not null) then raise exception 'Resolve outstanding information requests before closing.'; end if;
 perform public.ml_set_activity_status_before_information(p_activity_id,p_status,p_reason);
end; $$;

-- Fingerprints are server-generated; no browser reads or writes to this index.
create table public.receipt_fingerprints (
 attachment_id uuid primary key references public.attachments(id) on delete cascade,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 merchant text, amount numeric(12,2), currency text, purchase_date date,
 receipt_number text, indexed_at timestamptz not null default now()
);
create index on public.receipt_fingerprints(sha256);
alter table public.receipt_fingerprints enable row level security;
revoke all on public.receipt_fingerprints from public,anon,authenticated;
grant all on public.receipt_fingerprints to service_role;
create function public.ml_receipt_duplicates(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.ml_require_user();
 if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
  select distinct c.id as claim_id,c.status,c.amount,a.original_name as current_file,b.original_name as matched_file,
   case when x.sha256=y.sha256 then 'identical_file' else 'matching_receipt_details' end as basis,
   y.merchant,y.purchase_date,y.amount as receipt_amount,y.receipt_number
  from public.attachments a join public.receipt_fingerprints x on x.attachment_id=a.id
  join public.receipt_fingerprints y on y.attachment_id<>x.attachment_id
  join public.attachments b on b.id=y.attachment_id join public.claims c on c.id=b.claim_id
  where a.claim_id=p_claim_id and a.kind='receipt' and b.kind='receipt' and c.id<>p_claim_id and c.status<>'draft'
   and (x.sha256=y.sha256 or (
    x.merchant is not null and nullif(trim(x.merchant),'') is not null and lower(trim(x.merchant))=lower(trim(y.merchant))
    and x.amount=y.amount and x.currency=y.currency and x.purchase_date=y.purchase_date
    and (x.receipt_number is null or y.receipt_number is null or lower(trim(x.receipt_number))=lower(trim(y.receipt_number)))
   ))
  order by c.id limit 30
 ) s);
end; $$;
revoke all on function public.ml_request_information(uuid,text),public.ml_reply_information(uuid,text),public.ml_check_information_reply(),public.ml_set_activity_status(uuid,text,text),public.ml_receipt_duplicates(uuid) from public,anon,authenticated;
grant execute on function public.ml_request_information(uuid,text),public.ml_reply_information(uuid,text),public.ml_set_activity_status(uuid,text,text),public.ml_receipt_duplicates(uuid) to authenticated;
create or replace function public.ml_begin_ai_check(p_user uuid,p_claim uuid,p_signature text,p_model text) returns uuid
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
 if (select count(*) from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '24 hours')>=20 then
  raise exception 'Daily AI check limit reached (20 checks per user).';
 end if;
 update public.ai_claim_checks set status='failed',finished_at=now() where claim_id=p_claim and status='running';
 insert into public.ai_claim_checks(claim_id,requested_by,input_signature,model) values(p_claim,p_user,p_signature,p_model) returning id into rid;
 return rid;
end; $$;

commit;
