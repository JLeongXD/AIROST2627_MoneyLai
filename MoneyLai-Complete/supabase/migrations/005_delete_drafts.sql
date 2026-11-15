grant delete on table public.claims to authenticated;

create policy "Users can delete their own drafts"
on public.claims
for delete
to authenticated
using (
  claimant_id = (select auth.uid())
  and status = 'draft'
);