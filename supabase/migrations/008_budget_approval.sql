-- Apply once after 007. Existing activities remain authorised at their current budgets.
begin;
create table public.budget_requests (
 id uuid primary key default gen_random_uuid(),
 activity_id uuid references public.activities(id),
 name text not null, description text, event_date date,
 base_budget numeric(12,2), proposed_budget numeric(12,2) not null check(proposed_budget>=0),
 reason text not null, requested_by uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 reviewed_by uuid references public.profiles(id), review_note text,
 created_at timestamptz not null default now(), reviewed_at timestamptz
);
create unique index budget_one_pending on public.budget_requests(activity_id) where status='pending';
alter table public.budget_requests enable row level security;
revoke all on public.budget_requests from anon,authenticated;
-- No direct browser writes/reads. Dedicated role-checked endpoints below.

-- Replace the old direct-write endpoint so old clients cannot bypass approval.
create or replace function public.ml_save_activity(p_activity_id uuid,p_name text,p_description text,p_budget numeric,p_event_date date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); a public.activities; result uuid; spent numeric;
begin
 if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Activity name must contain 1 to 120 characters.'; end if;
 if p_budget is null or p_budget<0 or p_budget>9999999999.99 or p_budget<>round(p_budget,2) then raise exception 'Enter a valid budget with at most two decimal places.'; end if;
 if length(coalesce(p_description,''))>2000 then raise exception 'Activity description is too long.'; end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'Provide a request reason of 3 to 1000 characters.'; end if;
 if p_activity_id is not null then
  select * into a from public.activities where id=p_activity_id for update;
  if not found or a.status<>'active' then raise exception 'Only active activities can be updated.'; end if;
  if exists(select 1 from public.budget_requests where activity_id=a.id and status='pending') then raise exception 'This activity already has a pending budget request.'; end if;
  select coalesce(sum(amount),0) into spent from public.claims where activity_id=a.id and status in ('approved','paid');
  if p_budget<spent then raise exception 'Budget cannot be lower than approved expenditure.'; end if;
 end if;
 insert into public.budget_requests(activity_id,name,description,event_date,base_budget,proposed_budget,reason,requested_by)
 values(p_activity_id,trim(p_name),trim(p_description),p_event_date,a.budget,p_budget,trim(p_reason),u) returning id into result;
 return result;
end; $$;

create function public.ml_list_budget_requests() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.ml_require_user();
 if not exists(select 1 from public.profiles where id=auth.uid() and role in ('president','treasurer')) then raise exception 'President or Treasurer access required.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id),'[]'::jsonb)
 from (select r.*,p.display_name as requester_name,v.display_name as reviewer_name
 from public.budget_requests r join public.profiles p on p.id=r.requested_by
 left join public.profiles v on v.id=r.reviewed_by
 order by (r.status='pending') desc,r.created_at desc,r.id
 limit 500) s);
end; $$;

create function public.ml_decide_budget(p_request_id uuid,p_approve boolean,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); r public.budget_requests; a public.activities; aid uuid; spent numeric;
begin
 if not exists(select 1 from public.profiles where id=u and role='president') then raise exception 'President access required.'; end if;
 if p_approve is null then raise exception 'Select a decision.'; end if;
 if length(coalesce(p_note,''))>1000 or (not p_approve and length(trim(coalesce(p_note,'')))<3) then raise exception 'Rejection requires a reason of 3 to 1000 characters.'; end if;
 select activity_id into aid from public.budget_requests where id=p_request_id;
 -- Same activity-first locking order as claim approval and payment.
 if aid is not null then select * into a from public.activities where id=aid for update; end if;
 select * into r from public.budget_requests where id=p_request_id for update;
 if not found or r.status<>'pending' then raise exception 'Request is no longer pending.'; end if;
 if r.requested_by=u then raise exception 'You cannot approve or reject your own request.'; end if;
 if p_approve then
  if r.activity_id is null then
   insert into public.activities(name,description,event_date,budget,created_by)
   values(r.name,r.description,r.event_date,r.proposed_budget,r.requested_by) returning id into aid;
  else
   if a.status<>'active' then raise exception 'Activity is closed. Reject this request or reopen the activity first.'; end if;
   if a.budget<>r.base_budget then raise exception 'Budget changed since submission. Reject and request a fresh proposal.'; end if;
   select coalesce(sum(amount),0) into spent from public.claims where activity_id=aid and status in ('approved','paid');
   if r.proposed_budget<spent then raise exception 'Budget cannot be lower than approved expenditure. Reject and request a higher budget.'; end if;
   update public.activities set name=r.name,description=r.description,event_date=r.event_date,budget=r.proposed_budget,updated_at=now() where id=aid;
  end if;
  insert into public.activity_events(activity_id,actor_id,old_budget,new_budget,note)
  values(aid,u,r.base_budget,r.proposed_budget,'Budget approved: '||r.reason||case when nullif(trim(p_note),'') is not null then ' / '||trim(p_note) else '' end);
 end if;
 update public.budget_requests set status=case when p_approve then 'approved' else 'rejected' end,
 activity_id=case when p_approve then aid else activity_id end,reviewed_by=u,review_note=trim(coalesce(p_note,'')),reviewed_at=now() where id=r.id;
end; $$;

create function public.ml_cancel_budget(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); r public.budget_requests; aid uuid;
begin
 if not public.ml_is_treasurer() then raise exception 'Treasurer access required.'; end if;
 select activity_id into aid from public.budget_requests where id=p_request_id;
 if aid is not null then perform 1 from public.activities where id=aid for update; end if;
 select * into r from public.budget_requests where id=p_request_id for update;
 if not found or r.status<>'pending' or r.requested_by<>u then raise exception 'Only your own pending request can be cancelled.'; end if;
 update public.budget_requests set status='cancelled',review_note='Withdrawn by requester.',reviewed_at=now() where id=r.id;
end; $$;
revoke all on function public.ml_list_budget_requests(), public.ml_decide_budget(uuid,boolean,text), public.ml_cancel_budget(uuid) from public,anon,authenticated;
grant execute on function public.ml_list_budget_requests(), public.ml_decide_budget(uuid,boolean,text), public.ml_cancel_budget(uuid) to authenticated;
commit;
