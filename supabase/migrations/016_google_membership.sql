-- Existing deployments: apply once after 015. Existing accounts remain unchanged.
begin;
create table public.membership_applications (
 user_id uuid primary key references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected','completed')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references public.profiles(id),
 reason text,
 completed_at timestamptz
);
alter table public.membership_applications enable row level security;
revoke all on public.membership_applications from anon,authenticated;

-- Read-only status is separate from explicitly submitting an application.
create function public.ml_membership_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',a.status,'reason',a.reason,'created_at',a.created_at)
 from public.membership_applications a where a.user_id=auth.uid();
$$;
create function public.ml_request_membership() returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 perform 1 from public.profiles where id=u and account_status='invited' for update;
 if not found then raise exception 'Only an unactivated account can apply.'; end if;
 if not exists(select 1 from auth.identities where user_id=u and provider='google') then
   raise exception 'Verify your account with Google before applying.';
 end if;
 insert into public.membership_applications(user_id) values(u) on conflict(user_id) do nothing;
 if found then
   insert into public.member_management_events(actor_id,target_id,event_type,reason)
   values(u,u,'membership_requested','Requested club membership using Google.');
 end if;
end; $$;
create function public.ml_membership_applications() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.ml_require_president();
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'email',u.email,
   'display_name',p.display_name,'status',a.status,'created_at',a.created_at,'reason',a.reason)
   order by a.created_at) from public.membership_applications a join public.profiles p on p.id=a.user_id
   join auth.users u on u.id=a.user_id where a.status<>'completed'),'[]'::jsonb);
end; $$;
create function public.ml_review_membership(p_user uuid,p_approve boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.ml_require_president();
begin
 if p_approve is null or p_reason is null or length(trim(p_reason)) not between 3 and 500 then
   raise exception 'Enter a reason of 3 to 500 characters.';
 end if;
 perform 1 from public.profiles where id=p_user and account_status='invited' for update;
 if not found then raise exception 'This account is no longer awaiting activation.'; end if;
 update public.membership_applications set status=case when p_approve then 'approved' else 'rejected' end,
   reviewed_by=actor,reviewed_at=now(),reason=trim(p_reason)
 where user_id=p_user and (status='pending' or (status='rejected' and p_approve) or (status='approved' and not p_approve));
 if not found then raise exception 'Application has already changed. Refresh the list.'; end if;
 insert into public.member_management_events(actor_id,target_id,event_type,reason)
 values(actor,p_user,case when p_approve then 'membership_approved' else 'membership_rejected' end,trim(p_reason));
end; $$;
-- These two functions are server-only. Browser password updates cannot grant membership.
create function public.ml_validate_membership_activation(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.membership_applications a join public.profiles p on p.id=a.user_id
   where a.user_id=p_user and a.status='approved' and p.account_status='invited') then
   raise exception 'President approval is required before activation.';
 end if;
end; $$;
create function public.ml_complete_membership(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=p_user for update;
 perform public.ml_validate_membership_activation(p_user);
 update public.profiles set account_status='active',role='member' where id=p_user;
 update public.membership_applications set status='completed',completed_at=now() where user_id=p_user;
 insert into public.member_management_events(actor_id,target_id,event_type,reason)
 values(p_user,p_user,'membership_activated','Set a MoneyLai password after President approval.');
end; $$;
revoke all on function public.ml_membership_status(),public.ml_request_membership(),
 public.ml_membership_applications(),public.ml_review_membership(uuid,boolean,text),
 public.ml_validate_membership_activation(uuid),public.ml_complete_membership(uuid) from public,anon,authenticated;
grant execute on function public.ml_membership_status(),public.ml_request_membership(),
 public.ml_membership_applications(),public.ml_review_membership(uuid,boolean,text) to authenticated;
grant execute on function public.ml_validate_membership_activation(uuid),public.ml_complete_membership(uuid) to service_role;
commit;
