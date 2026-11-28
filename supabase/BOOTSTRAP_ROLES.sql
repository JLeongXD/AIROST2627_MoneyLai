-- Initial setup / emergency recovery only. Routine membership belongs in the website.
-- Keep compatible with projects whose migration 014 has not yet been applied.
-- Replace these sample emails with your actual initial account emails.
do $$
declare
  treasurer_emails text[] := array['treasurer1@example.com','treasurer2@example.com'];
  president_email text := 'president@example.com';
begin
  update public.profiles set role='treasurer'
  where id in (select id from auth.users where email=any(treasurer_emails));
  update public.profiles set role='president'
  where id in (select id from auth.users where email=president_email);
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='account_status') then
    execute $sql$update public.profiles set account_status='active' where id in
      (select id from auth.users where email=any($1) or email=$2)$sql$ using treasurer_emails,president_email;
  end if;
end; $$;

select
    p.id,
    u.email,
    p.display_name,
    p.role
from public.profiles p
join auth.users u on u.id = p.id
order by p.created_at;
