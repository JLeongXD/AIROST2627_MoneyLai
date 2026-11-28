import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const member = "11111111-1111-4111-8111-111111111111", fiscal = "22222222-2222-4222-8222-222222222222",
  president = "33333333-3333-4333-8333-333333333333", incoming = "44444444-4444-4444-8444-444444444444",
  stranger = "55555555-5555-4555-8555-555555555555";
test("Membership upgrade preserves finances, blocks old sessions, controls invitations and atomically transfers President", async () => {
  const db = new PGlite();
  async function as(role, id, sql, args = []) {
    await db.exec(`begin; set local role ${role};`);
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
      const rows = (await db.query(sql, args)).rows; await db.exec("commit"); return rows;
    } catch (e) { await db.exec("rollback"); throw e; }
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
      insert into auth.users(id,email) values ('${member}','member@example.com'),('${fiscal}','treasurer1@example.com'),('${president}','president@example.com');
    `);
    const root = new URL("../../supabase/", import.meta.url);
    for (const name of (await readdir(new URL("migrations/", root))).filter(n => /^\d{3}.*\.sql$/.test(n) && n < "014").sort()) await db.exec(await readFile(new URL(`migrations/${name}`, root), "utf8"));
    await db.exec(await readFile(new URL("BOOTSTRAP_ROLES.sql", root), "utf8"));
    const activity = (await db.query("insert into public.activities(name,budget) values('Members upgrade',1000) returning id")).rows[0].id;
    const claim = (await db.query("insert into public.claims(claimant_id,activity_id,amount,description,status) values($1,$2,10,'Retained claim','paid') returning id,claim_number", [member, activity])).rows[0];
    await db.exec(await readFile(new URL("migrations/014_member_management.sql", root), "utf8"));
    await db.exec(await readFile(new URL("migrations/015_ai_usage_limit.sql", root), "utf8"));
    // Shared rolling allowance: 99 recent runs + one expired run permit request 100.
    // Test the real public wrappers so inactive-account and private-helper guards survive.
    const quotaClaim = (await db.query("insert into public.claims(claimant_id,activity_id,amount,description,status) values($1,$2,1,'Quota test','draft') returning id", [member, activity])).rows[0].id;
    const first = (await user(member, "select public.ml_create_receipt_draft($1,'quota.png','image/png') as s", [activity]))[0].s;
    const next = (await user(member, "select public.ml_create_receipt_draft($1,'next.png','image/png') as s", [activity]))[0].s;
    await db.query("insert into public.ai_claim_checks(requested_by,input_signature,model,status,created_at) select $1,'quota-test','test','failed',now()-interval '2 minutes' from generate_series(1,99)", [member]);
    await db.query("insert into public.ai_claim_checks(requested_by,input_signature,model,status,created_at) values($1,'expired-test','test','failed',now()-interval '25 hours')", [member]);
    await server("select public.ml_begin_receipt_read($1,$2,'test')", [member, first.id]);
    await assert.rejects(server("select public.ml_begin_ai_check($1,$2,'quota','test')", [member, quotaClaim]), /30 seconds/);
    await db.query("update public.ai_claim_checks set created_at=now()-interval '31 seconds' where requested_by=$1 and status='running'", [member]);
    await assert.rejects(server("select public.ml_begin_receipt_read($1,$2,'test')", [member, next.id]), /100 checks per user/);
    await assert.rejects(server("select public.ml_begin_ai_check($1,$2,'quota','test')", [member, quotaClaim]), /100 checks per user/);
    await db.query("update public.ai_claim_checks set created_at=now()-interval '25 hours' where id=(select id from public.ai_claim_checks where input_signature='quota-test' limit 1)");
    await server("select public.ml_begin_ai_check($1,$2,'quota','test')", [member, quotaClaim]);
    await assert.rejects(user(member, "select public.ml_begin_ai_check_before_membership($1,$2,'x','test')", [member, quotaClaim]), /permission denied/);
    await assert.rejects(server("select public.ml_begin_receipt_read_before_membership($1,$2,'test')", [member, next.id]), /permission denied/);
    await db.query("delete from public.receipt_drafts where id in ($1,$2)", [first.id, next.id]);
    await db.query("delete from public.ai_claim_checks where requested_by=$1", [member]);
    await db.query("delete from public.claims where id=$1", [quotaClaim]);
    assert.equal((await db.query("select claim_number from public.claims where id=$1", [claim.id])).rows[0].claim_number, claim.claim_number);
    assert.equal((await user(member, "select * from public.claims")).length, 1);
    await assert.rejects(user(member, "select public.ml_members()"), /President/);
    await assert.rejects(user(fiscal, "select public.ml_members()"), /President/);
    await assert.rejects(as("anon", null, "select public.ml_members()"), /permission denied/);
    await assert.rejects(user(member, "select public.ml_change_member($1,'treasurer','Self promotion')", [member]), /President/);
    await assert.rejects(user(president, "select public.ml_change_member($1,'disable','Self disable')", [president]), /own/);
    await assert.rejects(user(president, "select public.ml_change_member($1,'president','Skip handover')", [member]), /Invalid/);
    await user(president, "select public.ml_change_member($1,'treasurer','New finance appointment')", [member]);
    assert.equal((await user(member, "select public.ml_is_treasurer() as yes"))[0].yes, true);
    await user(president, "select public.ml_change_member($1,'member','End finance appointment')", [member]);
    assert.equal((await user(member, "select public.ml_is_treasurer() as yes"))[0].yes, false);
    const path = `${member}/${claim.id}/receipt.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')", [path]);
    assert.equal((await user(member, "select * from storage.objects")).length, 1);
    await user(president, "select public.ml_change_member($1,'disable','Left the club')", [member]);
    // Same uid/JWT as before: no financial reads, RPC writes, Storage reads or uploads.
    assert.equal((await user(member, "select * from public.claims")).length, 0);
    assert.equal((await user(member, "select * from public.activities")).length, 0);
    assert.equal((await user(member, "select * from storage.objects")).length, 0);
    assert.equal((await user(member, "select account_status from public.profiles"))[0].account_status, "disabled");
    await assert.rejects(user(member, "select public.ml_save_claim(null,$1,10,'Blocked',null,'Other')", [activity]), /not active/);
    await assert.rejects(user(member, "select public.ml_activity_summary()"), /not active/);
    await assert.rejects(user(member, "select public.ml_activity_export($1)", [activity]), /not active/);
    await assert.rejects(user(member, "insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [path+"new"]), /row-level security/);
    await assert.rejects(server("select public.ml_begin_ai_check($1,$2,'x','model')", [member, claim.id]), /not active/);
    await assert.rejects(server("select public.ml_begin_receipt_read($1,$2,'model')", [member, claim.id]), /not active/);
    await assert.rejects(server("select public.ml_finish_receipt_claim($1,$2,'{}','{}','{}',0)", [member, claim.id]), /not active/);
    await user(president, "select public.ml_change_member($1,'restore','Rejoined the club')", [member]);
    assert.equal((await user(member, "select * from public.claims")).length, 1);
    await user(president, "select public.ml_change_member($1,'disable','Treasurer access suspended')", [fiscal]);
    assert.equal((await user(fiscal, "select public.ml_is_treasurer() as yes"))[0].yes, false);
    assert.equal((await user(fiscal, "select * from public.claims")).length, 0);
    await assert.rejects(user(fiscal, "select public.ml_list_budget_requests()"), /not active/);
    await user(president, "select public.ml_change_member($1,'restore','Treasurer access restored')", [fiscal]);
    // President directory provides membership, never payout records or invitation secrets.
    await user(member, "select public.ml_save_profile('Member','Member','Bank','123456')");
    const directory = (await user(president, "select public.ml_members() as data"))[0].data;
    assert.equal(directory.members[0].email, "member@example.com");
    assert.equal(JSON.stringify(directory).includes("123456"), false);
    assert.equal((await user(president, "select * from public.payout_details")).length, 0);
    await assert.rejects(user(president, "update public.profiles set account_status='active'"), /permission denied/);
    await assert.rejects(user(president, "delete from public.member_management_events"), /permission denied/);
    await assert.rejects(user(president, "select * from public.member_invitations"), /permission denied/);
    // New Auth users are invited regardless of user-controlled metadata.
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.com','{\"role\":\"president\",\"account_status\":\"active\"}'),($2,'stranger@example.com','{}')", [incoming, stranger]);
    assert.deepEqual((await db.query("select role,account_status from public.profiles where id=$1", [incoming])).rows[0], { role: "member", account_status: "invited" });
    await assert.rejects(user(incoming, "select public.ml_activity_summary()"), /not active/);
    let invitation = (await user(president, "select public.ml_prepare_invitation('NEW@example.com','New Member') as data"))[0].data;
    assert.equal(invitation.existing_user, incoming);
    await assert.rejects(user(president, "select public.ml_prepare_invitation('new@example.com','Duplicate')"), /already exists/);
    await assert.rejects(user(incoming, "select public.ml_activate_member($1,$2)", [incoming, invitation.token]), /permission denied/);
    await assert.rejects(server("select public.ml_activate_member($1,$2)", [incoming, invitation.token]), /expired/);
    await server("select public.ml_invitation_delivery($1,$2,$3,true)", [invitation.id, invitation.token, president]);
    await assert.rejects(server("select public.ml_validate_invitation($1,$2)", [stranger, invitation.token]), /another email/);
    await assert.rejects(server("select public.ml_validate_invitation($1,$2)", [president, invitation.token]), /another email/);
    assert.deepEqual((await db.query("select role,account_status from public.profiles where id=$1", [president])).rows[0], { role: "president", account_status: "active" });
    const originalToken = invitation.token;
    await assert.rejects(user(president, "select public.ml_prepare_invitation('','',$1)", [invitation.id]), /60 seconds/);
    await db.query("update public.member_invitations set last_attempt_at=now()-interval '61 seconds' where id=$1", [invitation.id]);
    invitation = (await user(president, "select public.ml_prepare_invitation('','',$1) as data", [invitation.id]))[0].data;
    assert.notEqual(invitation.token, originalToken);
    await assert.rejects(server("select public.ml_activate_member($1,$2)", [incoming, originalToken]), /expired/);
    await server("select public.ml_invitation_delivery($1,$2,$3,true)", [invitation.id, invitation.token, president]);
    await db.query("update public.member_invitations set expires_at=now()-interval '1 second' where id=$1", [invitation.id]);
    await assert.rejects(server("select public.ml_activate_member($1,$2)", [incoming, invitation.token]), /expired/);
    await db.query("update public.member_invitations set expires_at=now()+interval '1 day' where id=$1", [invitation.id]);
    await server("select public.ml_activate_member($1,$2)", [incoming, invitation.token]);
    await assert.rejects(server("select public.ml_activate_member($1,$2)", [incoming, invitation.token]), /expired/);
    assert.equal((await db.query("select account_status from public.profiles where id=$1", [incoming])).rows[0].account_status, "active");
    const revoked = (await user(president, "select public.ml_prepare_invitation('stranger@example.com','Other Member') as data"))[0].data;
    await server("select public.ml_invitation_delivery($1,$2,$3,true)", [revoked.id, revoked.token, president]);
    await user(president, "select public.ml_revoke_invitation($1,'Wrong invitation')", [revoked.id]);
    await assert.rejects(server("select public.ml_activate_member($1,$2)", [stranger, revoked.token]), /expired/);
    const safe = (await user(president, "select public.ml_members() as data"))[0].data;
    assert.equal(JSON.stringify(safe).includes(invitation.token), false);
    // Fresh-project bootstrap can activate only its explicitly named initial staff.
    const initialStaff = "66666666-6666-4666-8666-666666666666";
    await db.query("insert into auth.users(id,email) values($1,'treasurer2@example.com')", [initialStaff]);
    assert.equal((await db.query("select account_status from public.profiles where id=$1", [initialStaff])).rows[0].account_status, "invited");
    await db.exec(await readFile(new URL("BOOTSTRAP_ROLES.sql", root), "utf8"));
    assert.deepEqual((await db.query("select role,account_status from public.profiles where id=$1", [initialStaff])).rows[0], { role: "treasurer", account_status: "active" });
    assert.equal((await db.query("select account_status from public.profiles where id=$1", [stranger])).rows[0].account_status, "invited");
    // Handover requires the recipient, stays pending until acceptance, and is atomic.
    await user(president, "select public.ml_start_handover($1,'Next committee term')", [incoming]);
    let handover = (await user(incoming, "select public.ml_handover_status() as data"))[0].data;
    assert.equal((await user(member, "select public.ml_handover_status() as data"))[0].data, null);
    await assert.rejects(user(president, "select public.ml_resolve_handover($1,'accept','Accepting myself')", [handover.id]), /nominated/);
    await user(president, "select public.ml_change_member($1,'disable','Temporarily absent')", [incoming]);
    await assert.rejects(user(incoming, "select public.ml_resolve_handover($1,'accept','Ready to serve')", [handover.id]), /not active/);
    assert.equal((await db.query("select role from public.profiles where id=$1", [president])).rows[0].role, "president");
    await user(president, "select public.ml_change_member($1,'restore','Returned to committee')", [incoming]);
    await user(incoming, "select public.ml_resolve_handover($1,'accept','Ready to serve')", [handover.id]);
    const roles = (await db.query("select role from public.profiles where id in ($1,$2) order by id", [president, incoming])).rows.map(r => r.role);
    assert.deepEqual(roles, ["member", "president"]);
    assert.equal((await db.query("select count(*)::int as n from public.profiles where role='president' and account_status='active'")).rows[0].n, 1);
    await assert.rejects(user(president, "select public.ml_members()"), /President/);
    await assert.rejects(user(incoming, "select public.ml_change_member($1,'disable','Cannot lose President')", [incoming]), /own/);
    await assert.rejects(user(incoming, "select public.ml_resolve_handover($1,'accept','Duplicate acceptance')", [handover.id]), /no longer/);
    await user(incoming, "select public.ml_start_handover($1,'Next nomination')", [member]);
    handover = (await user(member, "select public.ml_handover_status() as data"))[0].data;
    await user(member, "select public.ml_resolve_handover($1,'decline','Not ready yet')", [handover.id]);
    await user(incoming, "select public.ml_start_handover($1,'New nomination')", [member]);
    handover = (await user(incoming, "select public.ml_handover_status() as data"))[0].data;
    await user(incoming, "select public.ml_resolve_handover($1,'cancel','Postponed election')", [handover.id]);
  } finally { await db.close(); }
});
