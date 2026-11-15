grant update (amount, description)
on table public.claims
to authenticated;

create policy "Users can update their own drafts"
on public.claims
for update
to authenticated
using (
  claimant_id = (select auth.uid())
  and status = 'draft'
)
with check (
  claimant_id = (select auth.uid())
  and status = 'draft'
);