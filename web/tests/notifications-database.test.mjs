import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Email outbox is transactional, private, leased, retryable and cancels stale approvals", async () => {
  const db = new PGlite();
  const member = "11111111-1111-4111-8111-111111111111";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table profiles(id uuid primary key); insert into profiles values('${member}');
      create table activities(id uuid primary key default gen_random_uuid(),name text);
      create table claims(id uuid primary key default gen_random_uuid(),claim_number bigint default 1,claimant_id uuid,activity_id uuid,amount numeric,status text);
      create table payments(claim_id uuid,paid_on date,reference text);
      create table claim_events(id uuid primary key default gen_random_uuid(),claim_id uuid,event_type text);
      grant usage on schema public to anon,authenticated,service_role;`);
    await db.exec(await readFile(new URL("../../supabase/migrations/017_claim_email_notifications.sql", import.meta.url), "utf8"));
    const activity = (await db.query("insert into activities(name) values('Test activity') returning id")).rows[0].id;
    const claim = (await db.query("insert into claims(claimant_id,activity_id,amount,status) values($1,$2,25,'submitted') returning id", [member,activity])).rows[0].id;
    const count = async () => (await db.query("select * from claim_email_notifications")).rows;
    await db.exec("begin");
    await db.query("insert into claim_events(claim_id,event_type) values($1,'approved')", [claim]);
    await db.exec("rollback");
    assert.equal((await count()).length,0);
    await db.query("update claims set status='approved' where id=$1",[claim]);
    await db.query("insert into claim_events(claim_id,event_type) values($1,'submitted'),($1,'approved')", [claim]);
    assert.equal((await count()).length,1);
    assert.equal((await count())[0].payload.claim_number,'ML-000001');
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from claim_email_notifications"), /permission denied/);
      await assert.rejects(db.query("select * from ml_take_claim_email(null)"), /permission denied/);
      await assert.rejects(db.query("select ml_finish_claim_email(gen_random_uuid(),gen_random_uuid(),true)"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const first = (await db.query("select * from ml_take_claim_email($1)",[claim])).rows[0];
    assert.equal(first.attempts,1);
    assert.equal((await db.query("select * from ml_take_claim_email($1)",[claim])).rows.length,0);
    assert.equal((await db.query("select ml_finish_claim_email($1,gen_random_uuid(),true) as ok",[first.id])).rows[0].ok,false);
    await db.query("select ml_finish_claim_email($1,$2,false)",[first.id,first.lease_token]);
    await db.exec("reset role");
    assert.equal((await count())[0].status,'pending');
    assert.ok(new Date((await count())[0].available_at)>new Date());
    await db.exec("update claim_email_notifications set available_at=now()-interval '1 second'");
    const retry = (await db.query("select * from ml_take_claim_email($1)",[claim])).rows[0];
    assert.notEqual(retry.lease_token,first.lease_token);
    await db.query("update claims set status='submitted' where id=$1",[claim]);
    assert.equal((await count())[0].status,'cancelled');
    assert.equal((await db.query("select ml_finish_claim_email($1,$2,true) as ok",[retry.id,retry.lease_token])).rows[0].ok,false);
    await db.query("update claims set status='approved' where id=$1",[claim]);
    await db.query("insert into claim_events(claim_id,event_type) values($1,'approved')",[claim]);
    await db.query("insert into payments values($1,'2026-11-26','REF-1')",[claim]);
    await db.query("update claims set status='paid' where id=$1",[claim]);
    await db.query("insert into claim_events(claim_id,event_type) values($1,'paid')",[claim]);
    const paid = (await db.query("select * from ml_take_claim_email(null)")).rows[0];
    assert.equal(paid.kind,'paid'); assert.equal(paid.payload.reference,'REF-1');
    await db.query("select ml_finish_claim_email($1,$2,true)",[paid.id,paid.lease_token]);
    assert.equal((await db.query("select * from ml_take_claim_email(null)")).rows.length,0);
    assert.equal((await count()).filter(n=>n.status==='sent').length,1);
  } finally { await db.close(); }
});
