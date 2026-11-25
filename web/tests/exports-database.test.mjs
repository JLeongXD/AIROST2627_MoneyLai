import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const member = "11111111-1111-4111-8111-111111111111";
const fiscal = "22222222-2222-4222-8222-222222222222";
const president = "33333333-3333-4333-8333-333333333333";
test("Export scopes, private files, and upgrade from retired procurement preserve financial history", async () => {
  const db = new PGlite();
  async function asUser(id, sql, args = []) {
    await db.exec("begin; set local role authenticated;");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
      const result = (await db.query(sql, args)).rows;
      await db.exec("commit"); return result;
    } catch (e) { await db.exec("rollback"); throw e; }
  }
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;
      grant select,insert,delete on storage.objects to authenticated;
      insert into auth.users(id,email) values ('${member}','member@example.com'),('${fiscal}','treasurer1@example.com'),('${president}','president@example.com');
    `);
    await db.exec(await readFile(new URL("../../supabase/SETUP_FRESH.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../supabase/BOOTSTRAP_ROLES.sql", import.meta.url), "utf8"));
    const activity = (await db.query("insert into public.activities(name,budget) values('Export test',1000) returning id")).rows[0].id;
    const claim = (await db.query("insert into public.claims(claimant_id,activity_id,amount,description,status) values($1,$2,120,'活动材料','paid') returning id,claim_number", [member, activity])).rows[0];
    await db.query("insert into public.claims(claimant_id,activity_id,amount,description,status) values($1,$2,80,'Approved','approved'),($1,$2,30,'Pending','submitted'),($1,$2,999,'Private draft','draft')", [member, activity]);
    await db.query("insert into public.payments(claim_id,paid_by,paid_on,reference,proof_path,amount,recipient_snapshot) values($1,$2,'2026-11-25','REF-123','private/proof.pdf',120,'{\"account_number\":\"SECRET_ACCOUNT\"}')", [claim.id, fiscal]);
    await db.query("insert into public.attachments(claim_id,kind,storage_path,original_name,mime_type,size_bytes,uploaded_by) values($1,'receipt','private/receipt.pdf','收据.pdf','application/pdf',100,$2)", [claim.id, member]);
    await db.query("insert into public.claim_events(claim_id,actor_id,event_type,note,snapshot) values($1,$2,'approved','Reviewed original','{\"secret\":\"SECRET_SNAPSHOT\"}')", [claim.id, fiscal]);
    await assert.rejects(asUser(member, "select public.ml_activity_export($1)", [activity]), /Only Treasurer or President/);
    const snapshot = (await asUser(fiscal, "select public.ml_activity_export($1) as data", [activity]))[0].data;
    assert.equal(snapshot.scope, "treasurer_evidence");
    assert.equal(snapshot.claims.length, 3); // No drafts.
    assert.equal(snapshot.claims[0].code, `ML-${String(claim.claim_number).padStart(6, "0")}`);
    assert.equal(snapshot.activity.remaining_budget, 800);
    assert.equal(snapshot.activity.unpaid_amount, 80);
    assert.equal(snapshot.activity.paid_amount, 120);
    assert.equal(snapshot.attachments.length, 1);
    assert.equal(snapshot.payments[0].reference, "REF-123");
    assert.equal(JSON.stringify(snapshot).includes("SECRET_"), false);
    const summary = (await asUser(president, "select public.ml_activity_export($1) as data", [activity]))[0].data;
    assert.equal(summary.scope, "president_summary");
    for (const key of ["attachments", "payments", "events", "activity_events"]) assert.deepEqual(summary[key], []);
    assert.equal(JSON.stringify(summary).includes("private/"), false);
    await assert.rejects(asUser(fiscal, "select public.ml_activity_export(gen_random_uuid())"), /Activity not found/);
    await assert.rejects(db.exec("begin; set local role anon; select public.ml_activity_export(gen_random_uuid());"), /permission denied/);
    await db.exec("rollback");
    for (const id of [fiscal, president]) {
      const name = `${id}/export.zip`;
      await asUser(id, "insert into storage.objects(bucket_id,name) values('activity-exports',$1)", [name]);
      assert.equal((await asUser(id, "select * from storage.objects where bucket_id='activity-exports'")).length, 1);
      assert.equal((await asUser(member, "select * from storage.objects where bucket_id='activity-exports'")).length, 0);
      const other = id === fiscal ? president : fiscal;
      assert.equal((await asUser(other, "delete from storage.objects where name=$1 returning name", [name])).length, 0);
      await assert.rejects(asUser(other, "insert into storage.objects(bucket_id,name) values('activity-exports',$1)", [`${id}/foreign.zip`]), /row-level security/);
      await asUser(id, "delete from storage.objects where name=$1", [name]);
    }
    await assert.rejects(asUser(member, "insert into storage.objects(bucket_id,name) values('activity-exports',$1)", [`${member}/export.zip`]), /row-level security/);

    // Simulate the retired 011's objects and budget guards without recreating the feature.
    await db.exec(`
      create table public.purchase_requests(id int primary key, note text);
      create table public.purchase_events(id int primary key, note text);
      insert into public.purchase_requests values(1,'Historical reservation');
      insert into public.purchase_events values(1,'Historical approval');
      grant select on public.purchase_requests,public.purchase_events to authenticated;
      create function public.ml_propose_purchase(text) returns text language sql as $$ select $1 $$;
      grant execute on function public.ml_propose_purchase(text) to authenticated;
      create function public.ml_guard_purchase_budget() returns trigger language plpgsql as $$ begin raise exception 'Retired purchase guard'; end $$;
      create trigger guard_purchase_activity before update on public.activities for each row execute function public.ml_guard_purchase_budget();
      create trigger guard_purchase_claim before update on public.claims for each row execute function public.ml_guard_purchase_budget();
    `);
    const original = await readFile(new URL("../../supabase/migrations/006_complete_workflow.sql", import.meta.url), "utf8");
    const summarySql = original.match(/create function public\.ml_activity_summary\(\)[\s\S]*?end; \$\$;/)[0];
    await db.exec(summarySql.replace("create function", "create or replace function").replace("a.budget-coalesce(s.committed,0)", "a.budget-coalesce(s.committed,0)-500"));
    assert.equal(Number((await asUser(fiscal, "select remaining_budget from public.ml_activity_summary() where id=$1", [activity]))[0].remaining_budget), 300);
    await db.exec(await readFile(new URL("../../supabase/migrations/012_activity_exports_only.sql", import.meta.url), "utf8"));
    assert.equal(Number((await asUser(fiscal, "select remaining_budget from public.ml_activity_summary() where id=$1", [activity]))[0].remaining_budget), 800);
    assert.equal((await db.query("select count(*)::int as n from public.purchase_requests")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from public.purchase_events")).rows[0].n, 1);
    assert.equal((await db.query("select claim_number from public.claims where id=$1", [claim.id])).rows[0].claim_number, claim.claim_number);
    await assert.rejects(asUser(fiscal, "select public.ml_propose_purchase('New purchase')"), /permission denied/);
    await assert.rejects(asUser(fiscal, "select * from public.purchase_requests"), /permission denied/);
    await db.query("update public.activities set description='No obsolete trigger' where id=$1", [activity]);
    await db.query("update public.claims set description='No obsolete trigger' where id=$1", [claim.id]);
    assert.equal((await db.query("select public from storage.buckets where id='activity-exports'")).rows[0].public, false);
  } finally { await db.close(); }
});
