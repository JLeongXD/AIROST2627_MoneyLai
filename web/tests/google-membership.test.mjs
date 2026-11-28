import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";

const president = "33333333-3333-4333-8333-333333333333";
const applicant = "44444444-4444-4444-8444-444444444444";
const other = "55555555-5555-4555-8555-555555555555";
test("Google membership requires approval and server activation; closed accounts cannot read finances", async () => {
  const db = new PGlite();
  async function as(role, id, sql, args = []) {
    await db.exec(`begin; set local role ${role};`);
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? ""]);
      const rows = (await db.query(sql, args)).rows;
      await db.exec("commit"); return rows;
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
      create table auth.identities(user_id uuid,provider text);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon,service_role;
      grant select,insert,delete on storage.objects to authenticated;
      insert into auth.users(id,email) values ('${president}','president@example.com');
    `);
    const root = new URL("../../supabase/", import.meta.url);
    await db.exec(await readFile(new URL("SETUP_FRESH.sql", root), "utf8"));
    await db.query("update public.profiles set role='president' where id=$1", [president]);
    await db.query("insert into auth.users(id,email) values($1,'applicant@gmail.com'),($2,'other@gmail.com')", [applicant, other]);
    await db.query("insert into auth.identities values($1,'google')", [applicant]);
    await db.exec("insert into public.activities(name,budget) values('Private budget',1000)");
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')", [`${applicant}/private/receipt.pdf`]);
    assert.equal((await user(applicant, "select public.ml_membership_status() as s"))[0].s, null);
    await assert.rejects(user(other, "select public.ml_request_membership()"), /Google/);
    await assert.rejects(as("anon", null, "select public.ml_request_membership()"), /permission denied/);
    await user(applicant, "select public.ml_request_membership()");
    await user(applicant, "select public.ml_request_membership()");
    assert.equal((await db.query("select count(*)::int n from public.membership_applications")).rows[0].n, 1);
    assert.equal((await user(applicant, "select public.ml_membership_status() as s"))[0].s.status, "pending");
    assert.equal((await user(other, "select public.ml_membership_status() as s"))[0].s, null);
    for (const id of [applicant, other]) {
      await assert.rejects(user(id, "select public.ml_membership_applications()"), /not active/);
      await assert.rejects(user(id, "select public.ml_review_membership($1,true,'Self approval')", [applicant]), /not active/);
      await assert.rejects(user(id, "select public.ml_complete_membership($1)", [applicant]), /permission denied/);
      await assert.rejects(user(id, "select * from public.membership_applications"), /permission denied/);
    }
    await assert.rejects(server("select public.ml_complete_membership($1)", [applicant]), /approval/);
    const applications = (await user(president, "select public.ml_membership_applications() as s"))[0].s;
    assert.equal(applications[0].email, "applicant@gmail.com");
    await user(president, "select public.ml_review_membership($1,true,'Verified club member')", [applicant]);
    assert.equal((await user(applicant, "select public.ml_membership_status() as s"))[0].s.status, "approved");
    assert.equal((await user(applicant, "select * from public.activities")).length, 0);
    assert.equal((await user(applicant, "select * from storage.objects")).length, 0);
    await assert.rejects(user(applicant, "select public.ml_activity_summary()"), /not active/);
    await server("select public.ml_validate_membership_activation($1)", [applicant]);
    // Approval revoked between password preflight and completion must still block activation.
    await user(president, "select public.ml_review_membership($1,false,'Membership not confirmed')", [applicant]);
    await assert.rejects(server("select public.ml_complete_membership($1)", [applicant]), /approval/);
    await user(applicant, "select public.ml_request_membership()");
    assert.equal((await user(applicant, "select public.ml_membership_status() as s"))[0].s.status, "rejected");
    await user(president, "select public.ml_review_membership($1,true,'Confirmed after review')", [applicant]);
    await server("select public.ml_complete_membership($1)", [applicant]);
    assert.equal((await user(applicant, "select public.ml_membership_status() as s"))[0].s.status, "completed");
    assert.equal((await user(applicant, "select * from public.activities")).length, 1);
    assert.equal((await user(applicant, "select role from public.profiles where id=$1", [applicant]))[0].role, "member");
    await assert.rejects(server("select public.ml_complete_membership($1)", [applicant]), /approval/);
    await user(president, "select public.ml_change_member($1,'disable','Left the club')", [applicant]);
    assert.equal((await user(applicant, "select * from public.activities")).length, 0);
    await assert.rejects(user(applicant, "select public.ml_request_membership()"), /unactivated/);
    assert.equal((await db.query("select count(*)::int n from public.member_management_events where event_type='membership_activated'")).rows[0].n, 1);
  } finally { await db.close(); }
});

const require = createRequire(import.meta.url);
async function loadRoute(imports) {
  const file = path.resolve("src/app/api/members/applications/activate/route.ts");
  const mod = new Module(file); mod.filename = file;
  mod.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  mod._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return mod.exports.POST;
}
test("Activation endpoint checks origin, session and approval before setting the current user's password", async () => {
  for (const scenario of ["foreign", "anonymous", "weak", "pending", "password-error", "revoked", "ok"]) {
    const calls = [];
    const admin = {
      rpc: async (name, args) => { calls.push([name, args]); return { error: (scenario === "pending" && name === "ml_validate_membership_activation") || (scenario === "revoked" && name === "ml_complete_membership") ? {} : null }; },
      auth: { admin: { updateUserById: async (...args) => { calls.push(["password", ...args]); return { error: scenario === "password-error" ? {} : null }; } } },
    };
    const post = await loadRoute({ "@/lib/members/server": {
      sameOrigin: request => request.headers.get("origin") === new URL(request.url).origin,
      memberJson: (data, status = 200) => Response.json(data, { status }),
      memberSession: async () => ({ user: scenario === "anonymous" ? null : { id: applicant } }),
      memberAdmin: () => admin,
    } });
    const response = await post(new Request("https://moneylai.example/api/members/applications/activate", {
      method: "POST", headers: { origin: scenario === "foreign" ? "https://evil.example" : "https://moneylai.example", "Content-Type": "application/json" },
      body: JSON.stringify({ password: scenario === "weak" ? "123" : "ExamplePassword123!", userId: president, role: "president" }),
    }));
    assert.equal(response.status, ({ foreign: 403, anonymous: 401, weak: 400, pending: 409, "password-error": 400, revoked: 409, ok: 200 })[scenario]);
    if (["foreign", "anonymous", "weak"].includes(scenario)) assert.equal(calls.length, 0);
    if (scenario === "pending") assert.equal(calls.some(c => c[0] === "password"), false);
    if (scenario === "password-error") assert.equal(calls.some(c => c[0] === "ml_complete_membership"), false);
    if (scenario === "ok") {
      assert.deepEqual(calls.map(c => c[0]), ["ml_validate_membership_activation", "password", "ml_complete_membership"]);
      assert.equal(calls[1][1], applicant);
    }
    assert.doesNotMatch(await response.text(), /ExamplePassword|service_role/);
  }
});
