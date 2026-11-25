import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Fresh installation includes all migrations, roles and AI access controls", async () => {
  const db = new PGlite();
  const sqlRoot = new URL("../../supabase/", import.meta.url);
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
      insert into auth.users(id,email) values
        ('11111111-1111-4111-8111-111111111111','member@example.com'),
        ('22222222-2222-4222-8222-222222222222','treasurer1@example.com'),
        ('33333333-3333-4333-8333-333333333333','president@example.com');
    `);
    const fresh = await readFile(new URL("SETUP_FRESH.sql", sqlRoot), "utf8");
    const files = (await readdir(new URL("migrations/", sqlRoot))).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
    let previous = -1;
    for (const name of files) {
      const migration = (await readFile(new URL(`migrations/${name}`, sqlRoot), "utf8")).trim();
      const index = fresh.indexOf(`-- Migration: ${name}\n${migration}`);
      assert.ok(index > previous, `${name} must be present unchanged and in order`);
      previous = index;
    }
    await db.exec(fresh);
    await db.exec(await readFile(new URL("BOOTSTRAP_ROLES.sql", sqlRoot), "utf8"));
    const roles = (await db.query("select role from public.profiles order by id")).rows.map((row) => row.role);
    assert.deepEqual(roles, ["member", "treasurer", "president"]);
    const grants = (await db.query("select has_function_privilege('authenticated','public.ml_begin_ai_check(uuid,uuid,text,text)','EXECUTE') as browser, has_function_privilege('service_role','public.ml_begin_ai_check(uuid,uuid,text,text)','EXECUTE') as server")).rows[0];
    assert.equal(grants.browser, false);
    assert.equal(grants.server, true);
    const activity = (await db.query("insert into public.activities(name,budget) values('Fresh test',1000) returning id")).rows[0].id;
    const member = "11111111-1111-4111-8111-111111111111";
    await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${member}',true);`);
    const claim = (await db.query("select public.ml_save_claim(null,$1,20,'Supplies','2026-01-01','Materials') as id", [activity])).rows[0].id;
    await db.exec("commit");
    await db.query("select public.ml_begin_ai_check($1,$2,'signature','test-model')", [member, claim]);
    await assert.rejects(db.query("select public.ml_begin_ai_check($1,$2,'signature','test-model')", [member, claim]), /already running/);
    await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${member}',true);`);
    assert.equal((await db.query("select * from public.ai_claim_checks")).rows.length, 1);
    await db.exec("commit");
    await db.exec("begin; set local role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);");
    assert.equal((await db.query("select * from public.ai_claim_checks")).rows.length, 0);
    await db.exec("commit");
    async function asUser(id, sql, args = []) {
      await db.exec("begin; set local role authenticated;");
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
        const result = await db.query(sql, args);
        await db.exec("commit");
        return result.rows;
      } catch (e) { await db.exec("rollback"); throw e; }
    }
    const fiscal = "22222222-2222-4222-8222-222222222222";
    const president = "33333333-3333-4333-8333-333333333333";
    const path = `${member}/${claim}/receipt.pdf`;
    await asUser(member, "select public.ml_save_profile('Student','Student','Bank','1234')");
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,$2)", [path, { mimetype: "application/pdf", size: 100 }]);
    const attachment = (await asUser(member, "select public.ml_register_attachment($1,$2,'Receipt.pdf','receipt') as id", [claim, path]))[0].id;
    await asUser(member, "select public.ml_submit_claim($1)", [claim]);
    await assert.rejects(asUser(member, "select public.ml_request_information($1,'Need date')", [claim]), /Treasurer/);
    await assert.rejects(asUser(president, "select public.ml_request_information($1,'Need date')", [claim]), /Treasurer/);
    await asUser(fiscal, "select public.ml_request_information($1,'Please clarify the club purpose')", [claim]);
    assert.equal((await db.query("select status from public.claims where id=$1", [claim])).rows[0].status, "needs_info");
    assert.equal((await asUser(president, "select * from public.claim_clarifications")).length, 0);
    await assert.rejects(asUser(fiscal, "select public.ml_review_claim($1,'approved','')", [claim]), /awaiting review/);
    await assert.rejects(asUser(fiscal, "select public.ml_set_activity_status($1,'closed','Closing event')", [activity]), /outstanding information/);
    await asUser(member, "select public.ml_return_to_draft($1)", [claim]);
    await assert.rejects(asUser(member, "select public.ml_submit_claim($1)", [claim]), /Reply to/);
    await assert.rejects(asUser(member, "select public.ml_reply_information($1,'')", [claim]), /3 to 2000/);
    await assert.rejects(asUser(fiscal, "select public.ml_reply_information($1,'Not my claim')", [claim]), /own draft/);
    await db.query("delete from storage.objects where name=$1", [path]);
    await assert.rejects(asUser(member, "select public.ml_reply_information($1,'Updated purpose')", [claim]), /Upload at least one receipt/);
    assert.equal((await db.query("select responded_at from public.claim_clarifications where claim_id=$1", [claim])).rows[0].responded_at, null);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,$2)", [path, { mimetype: "application/pdf", size: 100 }]);
    await asUser(member, "select public.ml_reply_information($1,'Supplies were used for the Fresh test workshop')", [claim]);
    const after = (await db.query("select status,info_requested_at from public.claims where id=$1", [claim])).rows[0];
    assert.equal(after.status, "submitted"); assert.equal(after.info_requested_at, null);
    assert.equal((await asUser(member, "select reply from public.claim_clarifications"))[0].reply, "Supplies were used for the Fresh test workshop");
    await assert.rejects(asUser(member, "select public.ml_reply_information($1,'Repeat response')", [claim]), /own draft/);
    assert.equal((await db.query("select count(*)::int as n from public.claim_events where claim_id=$1 and event_type='information_supplied'", [claim])).rows[0].n, 1);
    const otherClaim = (await db.query("insert into public.claims(claimant_id,activity_id,amount,description,status) values($1,$2,20,'Other purchase','submitted') returning id", [fiscal, activity])).rows[0].id;
    const otherAttachment = (await db.query("insert into public.attachments(claim_id,kind,storage_path,original_name,mime_type,size_bytes,uploaded_by) values($1,'receipt','test/other.pdf','Other.pdf','application/pdf',100,$2) returning id", [otherClaim, fiscal])).rows[0].id;
    await db.query("insert into public.receipt_fingerprints(attachment_id,sha256,merchant,amount,currency,purchase_date) values($1,$3,'Shop',20,'MYR','2026-01-01'),($2,$3,'Shop',20,'MYR','2026-01-01')", [attachment, otherAttachment, "a".repeat(64)]);
    await assert.rejects(asUser(member, "select public.ml_receipt_duplicates($1)", [claim]), /Treasurer/);
    await assert.rejects(asUser(member, "select * from public.receipt_fingerprints"), /permission denied/);
    let matches = (await asUser(fiscal, "select public.ml_receipt_duplicates($1) as matches", [claim]))[0].matches;
    assert.equal(matches[0].basis, "identical_file");
    await db.query("update public.receipt_fingerprints set sha256=$2 where attachment_id=$1", [otherAttachment, "b".repeat(64)]);
    matches = (await asUser(fiscal, "select public.ml_receipt_duplicates($1) as matches", [claim]))[0].matches;
    assert.equal(matches[0].basis, "matching_receipt_details");
    await db.query("update public.receipt_fingerprints set purchase_date=null where attachment_id=$1", [otherAttachment]);
    assert.equal((await asUser(fiscal, "select public.ml_receipt_duplicates($1) as matches", [claim]))[0].matches.length, 0);
    await db.query("update public.receipt_fingerprints set sha256=$2 where attachment_id=$1", [otherAttachment, "a".repeat(64)]);
    await db.query("update public.claims set status='draft' where id=$1", [otherClaim]);
    assert.equal((await asUser(fiscal, "select public.ml_receipt_duplicates($1) as matches", [claim]))[0].matches.length, 0);
  } finally {
    await db.close();
  }
});
