-- Apply after migration 006. Run in Supabase SQL Editor as project owner.
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('member','treasurer','president'));

-- Dedicated read endpoint: never grant President Treasurer privileges.
create function public.ml_president_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid; result jsonb;
begin
  u := public.ml_require_user();
  if not exists(select 1 from public.profiles p where p.id=u and p.role='president') then
    raise exception 'President access required.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'activities', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      from public.ml_activity_summary() a),
    'claim_count', (select count(*) from public.claims c where c.status <> 'draft'),
    'claims', (select coalesce(jsonb_agg(to_jsonb(s) order by s.submitted_at desc nulls last, s.id), '[]'::jsonb)
      from (select c.id,p.display_name as claimant_name,c.activity_id,a.name as activity_name,
        c.amount,c.description,c.status,c.submitted_at
        from public.claims c join public.profiles p on p.id=c.claimant_id
        join public.activities a on a.id=c.activity_id
        where c.status <> 'draft'
        order by c.submitted_at desc nulls last,c.id limit 500) s)
  ) into result;
  return result;
end; $$;
revoke all on function public.ml_president_overview() from public, anon, authenticated;
grant execute on function public.ml_president_overview() to authenticated;
-- Existing RLS/Storage policies and Treasurer write functions remain unchanged.
commit;
