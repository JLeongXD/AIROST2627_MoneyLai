import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { reading, selection } from "./fixtures/receipt.mjs";
const member = "11111111-1111-4111-8111-111111111111", fiscal = "22222222-2222-4222-8222-222222222222",
  president = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444";
test("Receipt assistant upgrade preserves claims, separates roles, retains revisions and binds retry-safe originals", async () => {
  const db = new PGlite();
  async function as(role, user, sql, args = []) {
    await db.exec(`begin; set local role ${role};`);
    try { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]); const rows = (await db.query(sql, args)).rows; await db.exec("commit"); return rows; }
    catch (e) { await db.exec("rollback"); throw e; }
  }
  const user = (id, sql, args) => as("authenticated", id, sql, args);
  const server = (sql, args) => as("service_role", null, sql, args);
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
      insert into auth.users(id,email) values ('${member}','member@example.com'),('${fiscal}','treasurer1@example.com'),('${president}','president@example.com'),('${other}','other@example.com');
    `);
    const root = new URL("../../supabase/", import.meta.url);
    for (const name of (await readdir(new URL("migrations/", root))).filter(n => /^\d{3}.*\.sql$/.test(n) && n < "013").sort()) await db.exec(await readFile(new URL(`migrations/${name}`, root), "utf8"));
    await db.exec(await readFile(new URL("BOOTSTRAP_ROLES.sql", root), "utf8"));
    const activity = (await db.query("insert into public.activities(name,budget) values('Receipt workshop',1000) returning id")).rows[0].id;
    const historical = (await db.query("insert into public.claims(claimant_id,activity_id,amount,description,status) values($1,$2,10,'Historical paid claim','paid') returning id,claim_number", [member, activity])).rows[0];
    await db.exec(await readFile(new URL("migrations/013_receipt_assistant.sql", root), "utf8"));
    assert.equal((await db.query("select claim_number from public.claims where id=$1", [historical.id])).rows[0].claim_number, historical.claim_number);
    const session = (await user(member, "select public.ml_create_receipt_draft($1,'收据.png','image/png') as s", [activity]))[0].s;
    await assert.rejects(user(other, "insert into storage.objects(bucket_id,name,metadata) values('receipt-drafts',$1,'{\"size\":100,\"mimetype\":\"image/png\"}')", [session.path]), /row-level security/);
    await user(member, "insert into storage.objects(bucket_id,name,metadata) values('receipt-drafts',$1,'{\"size\":100,\"mimetype\":\"image/png\"}')", [session.path]);
    assert.equal((await user(other, "select * from public.receipt_drafts")).length, 0);
    assert.equal((await user(fiscal, "select * from public.receipt_drafts")).length, 0);
    assert.equal((await user(president, "select * from storage.objects where bucket_id='receipt-drafts'")).length, 0);
    await assert.rejects(user(member, "update public.receipt_drafts set extraction='{}'"), /permission denied/);
    await assert.rejects(user(member, "select public.ml_begin_receipt_read($1,$2,'test')", [member, session.id]), /permission denied/);
    await assert.rejects(server("select public.ml_begin_receipt_read($1,$2,'test')", [other, session.id]), /unavailable/);
    await server("select public.ml_begin_receipt_read($1,$2,'test')", [member, session.id]);
    await assert.rejects(server("select public.ml_begin_receipt_read($1,$2,'test')", [member, session.id]), /already running/);
    await db.query("update public.receipt_drafts set status='complete',extraction=$2,sha256=$3,model='test-model' where id=$1", [session.id, reading, "a".repeat(64)]);
    const prepare = () => user(member, "select public.ml_prepare_receipt_claim($1,null,80,'Workshop supplies','2026-11-20','Materials',0) as id", [session.id]);
    const claim = (await prepare())[0].id;
    assert.equal((await prepare())[0].id, claim);
    assert.equal((await db.query("select count(*)::int as n from public.claims where description='Workshop supplies'")).rows[0].n, 1);
    const calculation = { expected_amount: "80.00", receipt_total: "100.00", selected_subtotal: "80.00", excluded_subtotal: "20.00", tax: "0.00", discount: "0.00", rounding: "0.00", method: "manual", adjustment_reason: selection.adjustment_reason, correction_reason: "", issues: [] };
    const fields = { amount: "80.00", description: "Workshop supplies", purchase_date: "2026-11-20", category: "Materials" };
    const finish = (revision, fieldValues = fields) => server("select public.ml_finish_receipt_claim($1,$2,$3,$4,$5,$6) as id", [member, session.id, selection, calculation, fieldValues, revision]);
    await assert.rejects(finish(0), /Upload the original/);
    const path = `${member}/${claim}/${session.id}.png`;
    await user(member, "insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{\"size\":100,\"mimetype\":\"image/png\"}')", [path]);
    await assert.rejects(user(member, "select public.ml_finish_receipt_claim($1,$2,$3,$4,$5,0)", [member, session.id, selection, calculation, fields]), /permission denied/);
    await finish(0);
    await assert.rejects(finish(0), /another window/);
    assert.equal((await user(member, "select revision from public.claim_receipt_plans"))[0].revision, 1);
    assert.equal((await user(fiscal, "select * from public.claim_receipt_plans")).length, 1);
    assert.equal((await user(president, "select * from public.claim_receipt_plans")).length, 0);
    assert.equal((await user(other, "select * from public.receipt_plan_history")).length, 0);
    await assert.rejects(user(member, "update public.claim_receipt_plans set calculation='{}'"), /permission denied/);
    // A user may edit the claim amount, but the original calculation remains intact for review.
    await user(member, "select public.ml_save_claim($1,$2,85,'Workshop supplies','2026-11-20','Materials')", [claim, activity]);
    assert.equal(Number((await user(member, "select amount from public.claims where id=$1", [claim]))[0].amount), 85);
    assert.equal((await user(member, "select calculation from public.claim_receipt_plans"))[0].calculation.expected_amount, "80.00");
    await finish(1, { ...fields, amount: "85.00" });
    const revisions = await user(member, "select revision,record from public.receipt_plan_history order by revision");
    assert.deepEqual(revisions.map(r => r.revision), [1, 2]);
    assert.equal(revisions[0].record.extraction.total, "100.00");
    assert.equal((await db.query("select count(*)::int as n from public.attachments where claim_id=$1", [claim])).rows[0].n, 1);
    assert.equal((await user(member, "select remaining_budget from public.ml_activity_summary() where id=$1", [activity]))[0].remaining_budget, "990.00");
    await user(member, "select public.ml_save_profile('Student','Student','Bank','1234')");
    await user(member, "select public.ml_submit_claim($1)", [claim]);
    await assert.rejects(finish(2), /own draft/);
    const snapshot = (await user(fiscal, "select public.ml_activity_export($1) as data", [activity]))[0].data;
    assert.equal(snapshot.receipt_plans.length, 1); assert.equal(snapshot.receipt_plan_history.length, 2);
    assert.equal(snapshot.receipt_plans[0].source_valid, true);
    const summary = (await user(president, "select public.ml_activity_export($1) as data", [activity]))[0].data;
    assert.equal(summary.receipt_plans, undefined); assert.equal(summary.receipt_plan_history, undefined);
    // Early warning is sanitized: no other claimant UUID, name, amount or reference.
    const second = (await user(other, "select public.ml_create_receipt_draft($1,'copy.png','image/png') as s", [activity]))[0].s;
    await db.query("update public.receipt_drafts set status='complete',extraction=$2,sha256=$3 where id=$1", [second.id, reading, "a".repeat(64)]);
    const warning = (await user(other, "select public.ml_receipt_draft_duplicates($1) as data", [second.id]))[0].data;
    assert.equal(Number(warning.other_matches), 1); assert.deepEqual(warning.own_matches, []);
    assert.equal(JSON.stringify(warning).includes(claim), false);
    await assert.rejects(user(member, "select public.ml_receipt_draft_duplicates($1)", [second.id]), /not found/);
    await assert.rejects(as("anon", null, "select public.ml_create_receipt_draft($1,'x.png','image/png')", [activity]), /permission denied/);
    await db.query("update public.receipt_drafts set expires_at=now()-interval '1 second' where id=$1", [second.id]);
    await assert.rejects(server("select public.ml_begin_receipt_read($1,$2,'test')", [other, second.id]), /expired/);
    await db.query("delete from public.attachments where claim_id=$1", [claim]);
    const changedSource = (await user(fiscal, "select public.ml_activity_export($1) as data", [activity]))[0].data;
    assert.equal(changedSource.receipt_plans[0].source_valid, false);
    assert.equal(changedSource.receipt_plan_history.length, 2);
  } finally { await db.close(); }
});
