-- Transactional outbox: no historical backfill and no email/network calls in financial RPCs.
create table public.claim_email_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.claim_events(id),
  claim_id uuid not null references public.claims(id),
  recipient_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('approved','paid')),
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','cancelled')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.claim_email_notifications enable row level security;
revoke all on public.claim_email_notifications from public, anon, authenticated;
grant select on public.claim_email_notifications to service_role;
create index on public.claim_email_notifications(status,available_at);

create function public.ml_enqueue_claim_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.event_type in ('approved','paid') then
    insert into public.claim_email_notifications(event_id,claim_id,recipient_id,kind,payload)
    select new.id,c.id,c.claimant_id,new.event_type,
      jsonb_build_object('claim_number','ML-'||lpad(c.claim_number::text,greatest(6,length(c.claim_number::text)),'0'),'amount',c.amount,
        'activity',a.name,'paid_on',p.paid_on,'reference',p.reference)
    from public.claims c join public.activities a on a.id=c.activity_id
    left join public.payments p on p.claim_id=c.id
    where c.id=new.claim_id
    on conflict(event_id) do nothing;
  end if;
  return new;
end; $$;
create trigger claim_email_enqueue after insert on public.claim_events
for each row execute function public.ml_enqueue_claim_email();

-- Do not send a delayed "awaiting payment" email after payment or revoked approval.
create function public.ml_cancel_stale_claim_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status='approved' and new.status<>'approved' then
    update public.claim_email_notifications set status='cancelled',lease_token=null
    where claim_id=new.id and kind='approved' and status in ('pending','sending');
  end if;
  return new;
end; $$;
create trigger claim_email_cancel after update of status on public.claims
for each row execute function public.ml_cancel_stale_claim_email();

-- Atomically lease one item, so concurrent requests cannot send the same pending item.
create function public.ml_take_claim_email(p_claim_id uuid default null)
returns setof public.claim_email_notifications
language sql security definer set search_path = '' as $$
  update public.claim_email_notifications n
  set status='sending',attempts=attempts+1,lease_token=gen_random_uuid(),available_at=now()+interval '10 minutes'
  where n.id=(select q.id from public.claim_email_notifications q
    where q.status in ('pending','sending') and q.available_at<=now()
      and (p_claim_id is null or q.claim_id=p_claim_id)
    order by q.created_at,q.id for update skip locked limit 1)
  returning n.*;
$$;
create function public.ml_finish_claim_email(p_id uuid,p_lease uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.claim_email_notifications
  set status=case when p_success then 'sent' else 'pending' end,
      sent_at=case when p_success then now() else null end,
      last_error=case when p_success then null else 'Email delivery failed. Check server configuration and retry.' end,
      available_at=now()+least(3600,60*power(2,least(attempts,6))) * interval '1 second',
      lease_token=null
  where id=p_id and lease_token=p_lease and status='sending';
  return found;
end; $$;
revoke all on function public.ml_enqueue_claim_email() from public,anon,authenticated;
revoke all on function public.ml_cancel_stale_claim_email() from public,anon,authenticated;
revoke all on function public.ml_take_claim_email(uuid) from public,anon,authenticated;
revoke all on function public.ml_finish_claim_email(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.ml_take_claim_email(uuid),public.ml_finish_claim_email(uuid,uuid,boolean) to service_role;
