-- Existing projects: run once AFTER 013. Existing accounts and financial records are retained.
-- Also allow your website's /join** redirect in Supabase Auth URL Configuration.
-- Keep {{ .ConfirmationURL }} in Invite/Recovery email templates; configure SMTP for real recipients.
-- Do not rerun SETUP_FRESH.sql or BOOTSTRAP_ROLES.sql on an existing deployment.
begin;

alter table public.profiles add column account_status text not null default 'active'
  check(account_status in ('active','invited','disabled'));
-- New Auth accounts cannot enter the club until an invitation is accepted.
alter table public.profiles alter column account_status set default 'invited';

create function public.ml_account_active(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=p_user and account_status='active');
$$;
create or replace function public.ml_require_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ml_account_active(auth.uid()) then
   raise exception 'Account is not active. Ask the President about your membership.';
 end if;
 return auth.uid();
end; $$;
create or replace function public.ml_is_treasurer() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='treasurer' and account_status='active');
$$;
create function public.ml_require_president() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.ml_require_user();
begin
 if not exists(select 1 from public.profiles where id=u and role='president') then
   raise exception 'President access required.';
 end if;
 return u;
end; $$;

-- Restrictive policies AND the existing ownership/financial-role policies.
-- An unexpired JWT from a disabled account must not retain direct table/storage access.
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='public' and rowsecurity loop
   execute format('create policy membership_active on public.%I as restrictive for all to authenticated using (public.ml_account_active(auth.uid())) with check (public.ml_account_active(auth.uid()))',t);
 end loop;
end; $$;
-- The account can still read its own minimal profile to display its membership status.
drop policy membership_active on public.profiles;
create policy membership_active on public.profiles as restrictive for select to authenticated
 using(id=auth.uid() or public.ml_account_active(auth.uid()));
create policy membership_active on storage.objects as restrictive for all to authenticated
 using(bucket_id not in ('receipts','payment-proofs','activity-exports','receipt-drafts') or public.ml_account_active(auth.uid()))
 with check(bucket_id not in ('receipts','payment-proofs','activity-exports','receipt-drafts') or public.ml_account_active(auth.uid()));

create table public.member_invitations (
 id uuid primary key default gen_random_uuid(),
 email text not null,
 display_name text not null,
 token uuid not null default gen_random_uuid(),
 status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 created_by uuid not null references public.profiles(id),
 accepted_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 sent_at timestamptz,
 delivery_status text not null default 'sending' check(delivery_status in ('sending','sent','failed')),
 last_attempt_at timestamptz not null default now(),
 accepted_at timestamptz
);
create unique index member_invitation_pending_email on public.member_invitations(email) where status='pending';
create table public.member_management_events (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.profiles(id),
 target_id uuid references public.profiles(id),
 event_type text not null,
 reason text not null,
 details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create table public.president_handovers (
 id uuid primary key default gen_random_uuid(),
 from_id uuid not null references public.profiles(id),
 to_id uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','accepted','cancelled','declined')),
 reason text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 resolved_at timestamptz,
 check(from_id<>to_id)
);
create unique index one_pending_president_handover on public.president_handovers((true)) where status='pending';
alter table public.member_invitations enable row level security;
alter table public.member_management_events enable row level security;
alter table public.president_handovers enable row level security;
revoke all on public.member_invitations,public.member_management_events,public.president_handovers from anon,authenticated;
-- Access is exclusively through narrow RPCs, so invitation tokens and Auth data are never listed.

create function public.ml_members() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.ml_require_president();
 return jsonb_build_object(
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,
    'email',u.email,'role',p.role,'account_status',p.account_status) order by p.created_at,p.id)
    from public.profiles p join auth.users u on u.id=p.id),'[]'::jsonb),
  'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'display_name',i.display_name,
    'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,
    'delivery_status',i.delivery_status,'sent_at',i.sent_at,'expires_at',i.expires_at,'created_at',i.created_at)
    order by i.created_at desc) from public.member_invitations i),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id) from (
    select e.id,e.created_at,e.event_type,e.reason,e.details,a.display_name as actor,t.display_name as target
    from public.member_management_events e join public.profiles a on a.id=e.actor_id
    left join public.profiles t on t.id=e.target_id order by e.created_at desc,e.id limit 100) e),'[]'::jsonb));
end; $$;

create function public.ml_change_member(p_user uuid,p_action text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid; p public.profiles; next_role text; next_status text;
begin
 perform pg_advisory_xact_lock(714014);
 u:=public.ml_require_president();
 if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Enter a reason of 3 to 500 characters.'; end if;
 select * into p from public.profiles where id=p_user for update;
 if not found then raise exception 'Member not found.'; end if;
 if p.id=u then raise exception 'You cannot change your own role or account status.'; end if;
 if p.role='president' then raise exception 'Use the President handover workflow for a President account.'; end if;
 next_role:=p.role; next_status:=p.account_status;
 if p_action in ('member','treasurer') then
   if p.account_status<>'active' then raise exception 'Only active members can change roles.'; end if;
   next_role:=p_action;
 elsif p_action='disable' then
   if p.account_status<>'active' then raise exception 'Only active members can be disabled.'; end if;
   next_status:='disabled';
 elsif p_action='restore' then
   if p.account_status<>'disabled' then raise exception 'Only disabled members can be restored.'; end if;
   next_status:='active';
 else raise exception 'Invalid member action.';
 end if;
 if next_role=p.role and next_status=p.account_status then raise exception 'This member already has that role.'; end if;
 update public.profiles set role=next_role,account_status=next_status where id=p_user;
 insert into public.member_management_events(actor_id,target_id,event_type,reason,details)
 values(u,p_user,p_action,trim(p_reason),jsonb_build_object('previous_role',p.role,'role',next_role,'previous_status',p.account_status,'status',next_status));
end; $$;

-- Reserve/rotate the app invitation BEFORE contacting Auth. Old app links become invalid immediately.
create function public.ml_prepare_invitation(p_email text,p_name text,p_invitation uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; i public.member_invitations; target uuid; v_email text:=lower(trim(p_email));
begin
 perform pg_advisory_xact_lock(714014);
 u:=public.ml_require_president();
 if p_invitation is null then
   if v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address.'; end if;
   if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Enter a name of 1 to 100 characters.'; end if;
   if exists(select 1 from public.member_invitations where email=v_email and status='pending') then raise exception 'An invitation already exists. Use Resend on that invitation.'; end if;
 else
   select * into i from public.member_invitations where id=p_invitation for update;
   if not found or i.status<>'pending' then raise exception 'Only a pending or expired invitation can be resent.'; end if;
   if i.last_attempt_at>now()-interval '60 seconds' then raise exception 'Wait 60 seconds before resending this invitation.'; end if;
   v_email:=i.email;
 end if;
 select a.id into target from auth.users a where lower(a.email)=v_email;
 if target is not null and exists(select 1 from public.profiles where id=target and account_status<>'invited') then
   raise exception 'This email already belongs to a club account. Manage the existing member instead.';
 end if;
 if p_invitation is null then
   insert into public.member_invitations(email,display_name,created_by) values(v_email,trim(p_name),u) returning * into i;
 else
   update public.member_invitations set token=gen_random_uuid(),expires_at=now()+interval '7 days',sent_at=null,
     delivery_status='sending',last_attempt_at=now() where id=i.id returning * into i;
 end if;
 insert into public.member_management_events(actor_id,event_type,reason,details)
 values(u,case when p_invitation is null then 'invited' else 'invitation_resent' end,'Member invitation requested.',jsonb_build_object('email',v_email,'invitation',i.id));
 return jsonb_build_object('id',i.id,'token',i.token,'email',v_email,'display_name',i.display_name,'existing_user',target);
end; $$;

-- Server-only delivery bookkeeping; failures remain visible and retryable.
create function public.ml_invitation_delivery(p_id uuid,p_token uuid,p_actor uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(714014);
 update public.member_invitations set delivery_status=case when p_success then 'sent' else 'failed' end,
   sent_at=case when p_success then now() else null end
 where id=p_id and token=p_token and status='pending';
 if not found then raise exception 'Invitation changed. Refresh the Members page.'; end if;
 insert into public.member_management_events(actor_id,event_type,reason,details)
 values(p_actor,case when p_success then 'invitation_sent' else 'invitation_delivery_failed' end,
   case when p_success then 'Invitation email accepted by the mail service.' else 'Email delivery failed. Resend is available.' end,jsonb_build_object('invitation',p_id));
end; $$;

create function public.ml_revoke_invitation(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 perform pg_advisory_xact_lock(714014); u:=public.ml_require_president();
 if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Enter a reason of 3 to 500 characters.'; end if;
 update public.member_invitations set status='revoked',token=gen_random_uuid() where id=p_id and status='pending';
 if not found then raise exception 'This invitation is no longer pending.'; end if;
 insert into public.member_management_events(actor_id,event_type,reason,details) values(u,'invitation_revoked',trim(p_reason),jsonb_build_object('invitation',p_id));
end; $$;

-- A verified Auth session AND the latest app invitation token are required.
-- No browser RPC can activate itself or choose a role.
create function public.ml_validate_invitation(p_user uuid,p_token uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 select i.id into result from public.member_invitations i join auth.users a on lower(a.email)=i.email
 join public.profiles p on p.id=a.id
 where a.id=p_user and p.account_status='invited' and i.token=p_token and i.status='pending'
   and i.expires_at>now() and i.sent_at is not null and i.delivery_status='sent';
 if result is null then raise exception 'Invitation is expired, revoked, replaced, or belongs to another email. Ask the President to resend it.'; end if;
 return result;
end; $$;
create function public.ml_activate_member(p_user uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare invite_id uuid; i public.member_invitations;
begin
 perform pg_advisory_xact_lock(714014);
 invite_id:=public.ml_validate_invitation(p_user,p_token);
 select * into i from public.member_invitations where id=invite_id for update;
 update public.profiles set account_status='active',role='member',display_name=i.display_name where id=p_user;
 update public.member_invitations set status='accepted',accepted_by=p_user,accepted_at=now() where id=i.id;
 insert into public.member_management_events(actor_id,target_id,event_type,reason,details)
 values(p_user,p_user,'invitation_accepted','Member set their own password and joined.',jsonb_build_object('invitation',i.id));
end; $$;

create function public.ml_handover_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.ml_require_user();
begin
 return (select jsonb_build_object('id',h.id,'from_id',h.from_id,'to_id',h.to_id,'from_name',a.display_name,
   'to_name',b.display_name,'reason',h.reason,'expires_at',h.expires_at)
   from public.president_handovers h join public.profiles a on a.id=h.from_id join public.profiles b on b.id=h.to_id
   where h.status='pending' and h.expires_at>now() and u in (h.from_id,h.to_id));
end; $$;
create function public.ml_start_handover(p_user uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 perform pg_advisory_xact_lock(714014); u:=public.ml_require_president();
 if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Enter a reason of 3 to 500 characters.'; end if;
 if u=p_user or not exists(select 1 from public.profiles where id=p_user and account_status='active' and role in ('member','treasurer')) then raise exception 'Select another active Member or Treasurer.'; end if;
 update public.president_handovers set status='cancelled',resolved_at=now() where status='pending' and expires_at<=now();
 if exists(select 1 from public.president_handovers where status='pending') then raise exception 'Resolve the existing President handover first.'; end if;
 insert into public.president_handovers(from_id,to_id,reason) values(u,p_user,trim(p_reason));
 insert into public.member_management_events(actor_id,target_id,event_type,reason) values(u,p_user,'handover_started',trim(p_reason));
end; $$;
create function public.ml_resolve_handover(p_id uuid,p_action text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid; h public.president_handovers;
begin
 perform pg_advisory_xact_lock(714014); u:=public.ml_require_user();
 if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Enter a reason of 3 to 500 characters.'; end if;
 select * into h from public.president_handovers where id=p_id for update;
 if not found or h.status<>'pending' or h.expires_at<=now() then raise exception 'This handover is no longer pending or has expired.'; end if;
 if p_action='accept' then
   if u<>h.to_id then raise exception 'Only the nominated member can accept this handover.'; end if;
   if not exists(select 1 from public.profiles where id=h.from_id and role='president' and account_status='active') then raise exception 'The current President is no longer eligible.'; end if;
   if not exists(select 1 from public.profiles where id=u and role in ('member','treasurer') and account_status='active') then raise exception 'The nominated member is no longer eligible.'; end if;
   update public.profiles set role='president' where id=u;
   update public.profiles set role='member' where id=h.from_id;
 elsif p_action='cancel' then
   if u<>h.from_id then raise exception 'Only the initiating President can cancel this handover.'; end if;
 elsif p_action='decline' then
   if u<>h.to_id then raise exception 'Only the nominated member can decline this handover.'; end if;
 else raise exception 'Invalid handover action.';
 end if;
 update public.president_handovers set status=case p_action when 'accept' then 'accepted' when 'cancel' then 'cancelled' else 'declined' end,resolved_at=now() where id=h.id;
 insert into public.member_management_events(actor_id,target_id,event_type,reason,details)
 values(u,case when u=h.from_id then h.to_id else h.from_id end,'handover_'||p_action,trim(p_reason),jsonb_build_object('from',h.from_id,'to',h.to_id));
end; $$;

-- Server operations must also recheck account status after their initial RLS reads.
alter function public.ml_begin_ai_check(uuid,uuid,text,text) rename to ml_begin_ai_check_before_membership;
alter function public.ml_begin_receipt_read(uuid,uuid,text) rename to ml_begin_receipt_read_before_membership;
alter function public.ml_finish_receipt_claim(uuid,uuid,jsonb,jsonb,jsonb,integer) rename to ml_finish_receipt_claim_before_membership;
revoke all on function public.ml_begin_ai_check_before_membership(uuid,uuid,text,text),public.ml_begin_receipt_read_before_membership(uuid,uuid,text),public.ml_finish_receipt_claim_before_membership(uuid,uuid,jsonb,jsonb,jsonb,integer) from public,anon,authenticated,service_role;
create function public.ml_begin_ai_check(p_user uuid,p_claim uuid,p_signature text,p_model text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not public.ml_account_active(p_user) then raise exception 'Account is not active.'; end if;
 return public.ml_begin_ai_check_before_membership(p_user,p_claim,p_signature,p_model);
end; $$;
create function public.ml_begin_receipt_read(p_user uuid,p_session uuid,p_model text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not public.ml_account_active(p_user) then raise exception 'Account is not active.'; end if;
 return public.ml_begin_receipt_read_before_membership(p_user,p_session,p_model);
end; $$;
create function public.ml_finish_receipt_claim(p_user uuid,p_session uuid,p_selection jsonb,p_calculation jsonb,p_fields jsonb,p_revision integer) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not public.ml_account_active(p_user) then raise exception 'Account is not active.'; end if;
 return public.ml_finish_receipt_claim_before_membership(p_user,p_session,p_selection,p_calculation,p_fields,p_revision);
end; $$;

revoke all on function public.ml_account_active(uuid),public.ml_require_president(),public.ml_members(),public.ml_change_member(uuid,text,text),
 public.ml_prepare_invitation(text,text,uuid),public.ml_invitation_delivery(uuid,uuid,uuid,boolean),public.ml_revoke_invitation(uuid,text),
 public.ml_validate_invitation(uuid,uuid),public.ml_activate_member(uuid,uuid),public.ml_handover_status(),public.ml_start_handover(uuid,text),
 public.ml_resolve_handover(uuid,text,text),public.ml_begin_ai_check(uuid,uuid,text,text),public.ml_begin_receipt_read(uuid,uuid,text),
 public.ml_finish_receipt_claim(uuid,uuid,jsonb,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.ml_account_active(uuid),public.ml_members(),public.ml_change_member(uuid,text,text),
 public.ml_prepare_invitation(text,text,uuid),public.ml_revoke_invitation(uuid,text),public.ml_handover_status(),
 public.ml_start_handover(uuid,text),public.ml_resolve_handover(uuid,text,text) to authenticated;
grant execute on function public.ml_invitation_delivery(uuid,uuid,uuid,boolean),public.ml_validate_invitation(uuid,uuid),public.ml_activate_member(uuid,uuid),
 public.ml_begin_ai_check(uuid,uuid,text,text),public.ml_begin_receipt_read(uuid,uuid,text),public.ml_finish_receipt_claim(uuid,uuid,jsonb,jsonb,jsonb,integer) to service_role;
notify pgrst,'reload schema';
commit;
