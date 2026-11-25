update public.profiles
set role = 'treasurer'
where id in (
    select id
    from auth.users
    where email in (
        'treasurer1@example.com',
        'treasurer2@example.com'
    )
);

-- Replace the sample email with your actual President account before running.
update public.profiles
set role = 'president'
where id in (
    select id from auth.users where email = 'president@example.com'
);

select
    p.id,
    u.email,
    p.display_name,
    p.role
from public.profiles p
join auth.users u on u.id = p.id
order by p.created_at;
