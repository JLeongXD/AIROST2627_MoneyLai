-- Run ONCE after 012. Adds optional single-receipt assistance; no budget changes.
begin;
create table public.receipt_drafts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 activity_id uuid not null references public.activities(id), claim_id uuid references public.claims(id) on delete set null,
 original_name text not null, mime_type text not null, storage_path text not null unique,
 status text not null default 'pending' check(status in ('pending','running','complete','failed')),
 extraction jsonb, sha256 text, model text, run_id uuid references public.ai_claim_checks(id),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours'
);
create index on public.receipt_drafts(user_id,created_at);
create table public.claim_receipt_plans (
 claim_id uuid primary key references public.claims(id) on delete cascade,
 session_id uuid not null unique references public.receipt_drafts(id),
 attachment_id uuid references public.attachments(id) on delete set null,
 revision integer not null, extraction jsonb not null, selection jsonb not null, calculation jsonb not null,
 sha256 text not null, model text not null, original_name text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.receipt_plan_history (
 id uuid primary key default gen_random_uuid(), claim_id uuid not null references public.claims(id) on delete cascade,
 revision integer not null, actor_id uuid not null references public.profiles(id),
 record jsonb not null, created_at timestamptz not null default now(), unique(claim_id,revision)
);
alter table public.receipt_drafts enable row level security;
alter table public.claim_receipt_plans enable row level security;
alter table public.receipt_plan_history enable row level security;
revoke all on public.receipt_drafts,public.claim_receipt_plans,public.receipt_plan_history from public,anon,authenticated;
grant select on public.receipt_drafts,public.claim_receipt_plans,public.receipt_plan_history to authenticated;
grant all on public.receipt_drafts,public.claim_receipt_plans,public.receipt_plan_history to service_role;
create policy receipt_draft_read on public.receipt_drafts for select to authenticated
using(user_id=auth.uid() or (claim_id is not null and public.ml_is_treasurer()));
create policy receipt_plan_read on public.claim_receipt_plans for select to authenticated
using(exists(select 1 from public.claims c where c.id=claim_id and (c.claimant_id=auth.uid() or public.ml_is_treasurer())));
create policy receipt_plan_history_read on public.receipt_plan_history for select to authenticated
using(exists(select 1 from public.claims c where c.id=claim_id and (c.claimant_id=auth.uid() or public.ml_is_treasurer())));

create function public.ml_create_receipt_draft(p_activity_id uuid,p_name text,p_mime text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); sid uuid:=gen_random_uuid(); path text;
begin
 if not exists(select 1 from public.activities where id=p_activity_id and status='active') then raise exception 'Choose an active activity first.'; end if;
 if p_name is null or length(p_name) not between 1 and 200 or p_mime is null or p_mime not in ('image/jpeg','image/png','application/pdf') then raise exception 'Choose a JPG, PNG or PDF with a name of at most 200 characters.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('moneylai-receipt-upload-'||u::text,0));
 if (select count(*) from public.receipt_drafts where user_id=u and created_at>now()-interval '24 hours')>=40 then raise exception 'Daily receipt upload limit reached. Use manual entry or try tomorrow.'; end if;
 path:=u::text||'/'||sid::text||'/source.'||case p_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' else 'jpg' end;
 insert into public.receipt_drafts(id,user_id,activity_id,original_name,mime_type,storage_path) values(sid,u,p_activity_id,p_name,p_mime,path);
 return jsonb_build_object('id',sid,'path',path);
end; $$;

-- Shared AI limit with the existing check endpoint. Only the authenticated server may reserve runs.
create function public.ml_begin_receipt_read(p_user uuid,p_session uuid,p_model text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.receipt_drafts; rid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('moneylai-ai-user-'||p_user::text,0));
 select * into s from public.receipt_drafts where id=p_session for update;
 if not found or s.user_id<>p_user or s.claim_id is not null or s.expires_at<=now() then raise exception 'Receipt draft is unavailable or expired.'; end if;
 if s.status='complete' then raise exception 'Receipt is already read. Use its saved extraction.'; end if;
 if s.status='running' and exists(select 1 from public.ai_claim_checks where id=s.run_id and created_at>now()-interval '3 minutes') then raise exception 'A receipt reading is already running.'; end if;
 if exists(select 1 from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '30 seconds') then raise exception 'Please wait 30 seconds before another AI request.'; end if;
 if (select count(*) from public.ai_claim_checks where requested_by=p_user and created_at>now()-interval '24 hours')>=20 then raise exception 'Daily AI check limit reached (20 checks per user).'; end if;
 insert into public.ai_claim_checks(requested_by,input_signature,model) values(p_user,'receipt:'||s.id::text,p_model) returning id into rid;
 update public.receipt_drafts set status='running',run_id=rid,model=p_model where id=s.id;
 return rid;
end; $$;

-- Returns only own-claim links; other claimants' matches are aggregated, never disclosed.
create function public.ml_receipt_draft_duplicates(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); s public.receipt_drafts; result jsonb;
begin
 select * into s from public.receipt_drafts where id=p_session and user_id=u and status='complete';
 if not found then raise exception 'Receipt reading not found.'; end if;
 select jsonb_build_object('other_matches',count(*) filter(where c.claimant_id<>u),
   'own_matches',coalesce(jsonb_agg(distinct jsonb_build_object('claim_id',c.id,'code','ML-'||lpad(c.claim_number::text,greatest(6,length(c.claim_number::text)),'0'),'status',c.status)) filter(where c.claimant_id=u),'[]'::jsonb)) into result
 from public.receipt_fingerprints f join public.attachments a on a.id=f.attachment_id join public.claims c on c.id=a.claim_id
 where c.status not in ('draft','rejected','cancelled') and c.id is distinct from s.claim_id
 and (f.sha256=s.sha256 or (
   nullif(lower(trim(s.extraction->>'merchant')),'')=lower(trim(f.merchant))
   and f.amount=(s.extraction->>'total')::numeric and f.currency=s.extraction->>'currency'
   and f.purchase_date=(s.extraction->>'date')::date
   and (nullif(trim(s.extraction->>'receipt_number'),'') is null or nullif(trim(f.receipt_number),'') is null or lower(trim(f.receipt_number))=lower(trim(s.extraction->>'receipt_number')))
 ));
 return result;
end; $$;

create function public.ml_prepare_receipt_claim(p_session uuid,p_claim_id uuid,p_amount numeric,p_description text,p_date date,p_category text,p_revision integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.ml_require_user(); s public.receipt_drafts; cid uuid; c public.claims;
begin
 -- Serialize session binding, including retries, without reversing the activity/claim lock order.
 perform pg_advisory_xact_lock(hashtextextended('moneylai-receipt-session-'||p_session::text,0));
 select * into s from public.receipt_drafts where id=p_session and user_id=u;
 if not found or s.status<>'complete' or (s.claim_id is null and s.expires_at<=now()) then raise exception 'Receipt draft is unavailable or expired.'; end if;
 cid:=coalesce(s.claim_id,p_claim_id);
 if s.claim_id is not null and p_claim_id is not null and s.claim_id<>p_claim_id then raise exception 'This receipt belongs to another draft.'; end if;
 if cid is null then
   cid:=public.ml_save_claim(null,s.activity_id,p_amount,p_description,p_date,p_category);
 else
   c:=public.ml_lock_claim(cid);
   if c.claimant_id<>u or c.status<>'draft' or c.activity_id<>s.activity_id then raise exception 'Only your matching activity draft can use this receipt.'; end if;
 end if;
 if coalesce((select revision from public.claim_receipt_plans where claim_id=cid),0)<>p_revision then raise exception 'This draft changed in another window. Reload it before saving.'; end if;
 if exists(select 1 from public.attachments a where a.claim_id=cid and a.kind='receipt' and a.storage_path<>u::text||'/'||cid::text||'/'||s.id::text||case s.mime_type when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end) then raise exception 'AI item selection supports one receipt. Remove the existing receipt first, or continue with manual entry.'; end if;
 update public.receipt_drafts set claim_id=cid where id=s.id;
 return cid;
end; $$;

-- Server-only commit: original bytes are verified against sha256 before this RPC.
create function public.ml_finish_receipt_claim(p_user uuid,p_session uuid,p_selection jsonb,p_calculation jsonb,p_fields jsonb,p_revision integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.receipt_drafts; c public.claims; aid uuid; path text; meta jsonb; revision_next integer; amount_value numeric; date_value date;
begin
 select * into s from public.receipt_drafts where id=p_session and user_id=p_user and status='complete';
 if not found or s.claim_id is null then raise exception 'Receipt draft is unavailable.'; end if;
 perform 1 from public.activities where id=s.activity_id and status='active' for update;
 if not found then raise exception 'This activity is closed.'; end if;
 select * into c from public.claims where id=s.claim_id for update;
 if c.claimant_id<>p_user or c.status<>'draft' then raise exception 'Only your own draft can be edited.'; end if;
 if coalesce((select revision from public.claim_receipt_plans where claim_id=c.id),0)<>p_revision then raise exception 'This draft changed in another window. Reload before saving.'; end if;
 amount_value:=(p_fields->>'amount')::numeric; date_value:=(p_fields->>'purchase_date')::date;
 if amount_value is null or amount_value<=0 or amount_value>9999999999.99 or amount_value<>round(amount_value,2) or date_value is null or date_value>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Enter a valid claim amount and purchase date.'; end if;
 if length(trim(coalesce(p_fields->>'description',''))) not between 1 and 500 or coalesce(p_fields->>'category','') not in ('Materials','Food & Drinks','Transport','Venue','Equipment','Other') then raise exception 'Enter a valid description and category.'; end if;
 path:=p_user::text||'/'||c.id::text||'/'||s.id::text||case s.mime_type when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end;
 select metadata into meta from storage.objects where bucket_id='receipts' and name=path;
 if not found then raise exception 'Upload the original receipt first.'; end if;
 if exists(select 1 from public.attachments where claim_id=c.id and kind='receipt' and storage_path<>path) then raise exception 'Item selection supports one receipt per claim.'; end if;
 select id into aid from public.attachments where claim_id=c.id and storage_path=path;
 if aid is null then
   if (select count(*) from public.attachments where claim_id=c.id)>=5 then raise exception 'Maximum five attachments per claim.'; end if;
   insert into public.attachments(claim_id,kind,storage_path,original_name,mime_type,size_bytes,uploaded_by)
   values(c.id,'receipt',path,s.original_name,s.mime_type,coalesce((meta->>'size')::bigint,0),p_user) returning id into aid;
 end if;
 revision_next:=p_revision+1;
 insert into public.claim_receipt_plans(claim_id,session_id,attachment_id,revision,extraction,selection,calculation,sha256,model,original_name)
 values(c.id,s.id,aid,revision_next,s.extraction,p_selection,p_calculation,s.sha256,s.model,s.original_name)
 on conflict(claim_id) do update set session_id=excluded.session_id,attachment_id=excluded.attachment_id,revision=excluded.revision,
 extraction=excluded.extraction,selection=excluded.selection,calculation=excluded.calculation,sha256=excluded.sha256,model=excluded.model,original_name=excluded.original_name,updated_at=now();
 update public.claims set amount=amount_value,description=trim(p_fields->>'description'),purchase_date=date_value,category=p_fields->>'category',updated_at=now() where id=c.id;
 insert into public.receipt_plan_history(claim_id,revision,actor_id,record) select c.id,revision_next,p_user,to_jsonb(p) from public.claim_receipt_plans p where p.claim_id=c.id;
 insert into public.claim_events(claim_id,actor_id,event_type,note) values(c.id,p_user,'receipt_selection_saved','Receipt item selection saved (revision '||revision_next||'). Expected RM '||(p_calculation->>'expected_amount')||'; claimed RM '||amount_value||'.');
 insert into public.receipt_fingerprints(attachment_id,sha256,merchant,amount,currency,purchase_date,receipt_number)
 values(aid,s.sha256,s.extraction->>'merchant',(s.extraction->>'total')::numeric,s.extraction->>'currency',(s.extraction->>'date')::date,s.extraction->>'receipt_number')
 on conflict(attachment_id) do update set sha256=excluded.sha256,merchant=excluded.merchant,amount=excluded.amount,currency=excluded.currency,purchase_date=excluded.purchase_date,receipt_number=excluded.receipt_number;
 return c.id;
end; $$;
revoke all on function public.ml_create_receipt_draft(uuid,text,text),public.ml_receipt_draft_duplicates(uuid),public.ml_prepare_receipt_claim(uuid,uuid,numeric,text,date,text,integer),public.ml_begin_receipt_read(uuid,uuid,text),public.ml_finish_receipt_claim(uuid,uuid,jsonb,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.ml_create_receipt_draft(uuid,text,text),public.ml_receipt_draft_duplicates(uuid),public.ml_prepare_receipt_claim(uuid,uuid,numeric,text,date,text,integer) to authenticated;
grant execute on function public.ml_begin_receipt_read(uuid,uuid,text),public.ml_finish_receipt_claim(uuid,uuid,jsonb,jsonb,jsonb,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipt-drafts','receipt-drafts',false,5242880,array['image/jpeg','image/png','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy receipt_draft_upload on storage.objects for insert to authenticated
with check(bucket_id='receipt-drafts' and exists(select 1 from public.receipt_drafts s where s.user_id=auth.uid() and s.storage_path=name and s.status='pending' and s.expires_at>now()));
create policy receipt_draft_file_read on storage.objects for select to authenticated
using(bucket_id='receipt-drafts' and exists(select 1 from public.receipt_drafts s where s.user_id=auth.uid() and s.storage_path=name));
create policy receipt_draft_file_delete on storage.objects for delete to authenticated
using(bucket_id='receipt-drafts' and exists(select 1 from public.receipt_drafts s where s.user_id=auth.uid() and s.storage_path=name and s.claim_id is null and (s.status<>'running' or s.expires_at<now())));

-- Preserve summary privacy while adding selection evidence to Treasurer exports.
alter function public.ml_activity_export(uuid) rename to ml_activity_export_before_receipt_assistant;
revoke all on function public.ml_activity_export_before_receipt_assistant(uuid) from public,anon,authenticated;
create function public.ml_activity_export(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.ml_activity_export_before_receipt_assistant(p_activity_id);
 if public.ml_is_treasurer() then
   result:=result||jsonb_build_object('receipt_plans',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('source_valid',
     (select count(*) from public.attachments a where a.claim_id=p.claim_id and a.kind='receipt')=1 and exists(select 1 from public.attachments a where a.id=p.attachment_id and a.claim_id=p.claim_id and a.kind='receipt')) order by p.claim_id)
     from public.claim_receipt_plans p join public.claims c on c.id=p.claim_id where c.activity_id=p_activity_id and c.status<>'draft'),'[]'::jsonb),
    'receipt_plan_history',coalesce((select jsonb_agg(jsonb_build_object('claim_id',h.claim_id,'revision',h.revision,'created_at',h.created_at,'actor',u.display_name,'record',h.record) order by h.created_at,h.id) from public.receipt_plan_history h join public.claims c on c.id=h.claim_id join public.profiles u on u.id=h.actor_id where c.activity_id=p_activity_id and c.status<>'draft'),'[]'::jsonb));
 end if;
 return result;
end; $$;
revoke all on function public.ml_activity_export(uuid) from public,anon,authenticated;
grant execute on function public.ml_activity_export(uuid) to authenticated;
commit;
