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
  } finally {
    await db.close();
  }
});
