grant usage on schema public to authenticated;

grant select on table public.activities to authenticated;

create policy "Authenticated users can read activities"
on public.activities
for select
to authenticated
using (true);