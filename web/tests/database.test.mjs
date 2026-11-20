import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(
  process.env.MONEYLAI_PGLITE_MODULE || "@electric-sql/pglite",
);
const db = new PGlite();
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../",
);
let count = 0;
const ids = {
  member: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  fiscal: "33333333-3333-4333-8333-333333333333",
  second: "44444444-4444-4444-8444-444444444444",
};
async function query(sql, args = []) {
  return (await db.query(sql, args)).rows;
}
async function as(user, job) {
  await db.exec("begin; set local role authenticated;");
  try {
    await query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    const result = await job();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function rejected(job, pattern) {
  let caught;
  try {
    await job();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "Expected operation to fail");
  if (pattern) assert.match(caught.message, pattern);
}
async function test(name, job) {
  await job();
  count++;
  console.log(`PASS ${count}: ${name}`);
}
async function rpc(user, name, args = []) {
  if (name === "ml_activity_summary")
    return as(user, () => query("select * from public.ml_activity_summary()"));
  return as(user, () =>
    query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    ),
  ).then((rows) => rows[0].result);
}
async function newClaim(
  user,
  activity,
  amount = "120",
  description = "Workshop materials",
) {
  return rpc(user, "ml_save_claim", [
    null,
    activity,
    amount,
    description,
    "2026-01-01",
    "Materials",
  ]);
}
async function receipt(user, claim, kind = "receipt") {
  const file = `${user}/${claim}/${crypto.randomUUID()}.pdf`;
  await as(user, () =>
    query(
      "insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,$2)",
      [file, { mimetype: "application/pdf", size: 1000 }],
    ),
  );
  const attachment = await rpc(user, "ml_register_attachment", [
    claim,
    file,
    "Receipt.pdf",
    kind,
  ]);
  return { file, attachment };
}
async function proof(user, claim) {
  const file = `${user}/${claim}/${crypto.randomUUID()}.pdf`;
  await as(user, () =>
    query(
      "insert into storage.objects(bucket_id,name,metadata) values('payment-proofs',$1,$2)",
      [file, { mimetype: "application/pdf", size: 1000 }],
    ),
  );
  return file;
}
try {
  // Only Auth/Storage infrastructure is stubbed. MoneyLai migrations, PL/pgSQL,
  // constraints, RLS and authenticated database roles are executed unchanged.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,anon;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  for (const [name, id] of Object.entries(ids))
    await query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${name}@example.test`,
    ]);
  for (const name of [
    "001_create_activities.sql",
    "002_read_activities.sql",
    "003_create_claims.sql",
    "004_edit_drafts.sql",
    "005_delete_drafts.sql",
  ])
    await db.exec(
      await readFile(path.join(root, "supabase/migrations", name), "utf8"),
    );
  const legacyActivity = (
    await query(
      "insert into public.activities(name,budget) values('Existing activity',1000) returning id",
    )
  )[0].id;
  const legacyClaim = (
    await query(
      "insert into public.claims(claimant_id,activity_id,amount,description) values($1,$2,25,'Existing draft') returning id",
      [ids.member, legacyActivity],
    )
  )[0].id;
  await db.exec(
    await readFile(
      path.join(root, "supabase/migrations/006_complete_workflow.sql"),
      "utf8",
    ),
  );
  await query(
    "update public.profiles set role='treasurer' where id in ($1,$2)",
    [ids.fiscal, ids.second],
  );
  await test("Existing activities and claims survive migration", async () => {
    assert.equal(
      (
        await query("select amount from public.claims where id=$1", [
          legacyClaim,
        ])
      )[0].amount,
      "25.00",
    );
  });
  await test("Profiles are backfilled; user metadata cannot assign treasurer role", async () => {
    assert.equal(
      (await query("select count(*)::int n from public.profiles"))[0].n,
      4,
    );
    const id = "55555555-5555-4555-8555-555555555555";
    await query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.test','{\"role\":\"treasurer\"}')",
      [id],
    );
    assert.equal(
      (await query("select role from public.profiles where id=$1", [id]))[0]
        .role,
      "member",
    );
  });
  await test("Anonymous clients cannot read claims or call mutation RPCs", async () => {
    await db.exec("begin;set local role anon;");
    try {
      await rejected(
        () => query("select * from public.claims"),
        /permission denied/,
      );
    } finally {
      await db.exec("rollback");
    }
    await db.exec("begin;set local role anon;");
    try {
      await rejected(
        () => query("select public.ml_activity_summary()"),
        /permission denied/,
      );
    } finally {
      await db.exec("rollback");
    }
  });
  await test("RLS hides other members’ claims", async () => {
    assert.equal(
      (
        await as(ids.other, () =>
          query("select * from public.claims where id=$1", [legacyClaim]),
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await as(ids.member, () =>
          query("select * from public.claims where id=$1", [legacyClaim]),
        )
      ).length,
      1,
    );
    assert.equal(
      (
        await as(ids.fiscal, () =>
          query("select * from public.claims where id=$1", [legacyClaim]),
        )
      ).length,
      1,
    );
  });
  await test("Members cannot elevate roles, alter status directly, or call internal helpers", async () => {
    await rejected(
      () =>
        as(ids.member, () =>
          query("update public.profiles set role='treasurer' where id=$1", [
            ids.member,
          ]),
        ),
      /permission denied/,
    );
    await rejected(
      () =>
        as(ids.member, () =>
          query("update public.claims set status='approved' where id=$1", [
            legacyClaim,
          ]),
        ),
      /permission denied/,
    );
    await rejected(
      () =>
        as(ids.member, () =>
          query("select public.ml_lock_claim($1)", [legacyClaim]),
        ),
      /permission denied/,
    );
  });
  await test("Claim amount validation runs in the database", async () => {
    await rejected(
      () => newClaim(ids.member, legacyActivity, "0"),
      /positive amount/,
    );
    await rejected(
      () => newClaim(ids.member, legacyActivity, "1.999"),
      /decimal places/,
    );
  });
  const claim = await newClaim(ids.member, legacyActivity);
  await test("Drafts belong to the authenticated user and can be edited", async () => {
    await rpc(ids.member, "ml_save_claim", [
      claim,
      legacyActivity,
      "120",
      "Updated materials",
      "2026-01-01",
      "Materials",
    ]);
    await rejected(
      () =>
        rpc(ids.other, "ml_save_claim", [
          claim,
          legacyActivity,
          "1",
          "Tampered",
          "2026-01-01",
          "Materials",
        ]),
      /own draft/,
    );
    assert.equal(
      (
        await query("select claimant_id from public.claims where id=$1", [
          claim,
        ])
      )[0].claimant_id,
      ids.member,
    );
  });
  await test("Submission requires payout details and a receipt", async () => {
    await rejected(
      () => rpc(ids.member, "ml_submit_claim", [claim]),
      /payout details/,
    );
    await rpc(ids.member, "ml_save_profile", [
      "Member One",
      "Member One",
      "Test Bank",
      "123456789",
    ]);
    await rejected(
      () => rpc(ids.member, "ml_submit_claim", [claim]),
      /receipt/,
    );
    await receipt(ids.member, claim, "supporting");
    await rejected(
      () => rpc(ids.member, "ml_submit_claim", [claim]),
      /receipt/,
    );
  });
  const doc = await receipt(ids.member, claim);
  await test("Private receipt storage rejects uploads into another user folder", async () => {
    await rejected(
      () =>
        as(ids.other, () =>
          query(
            "insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')",
            [`${ids.member}/${claim}/intrusion.pdf`],
          ),
        ),
      /row-level security/,
    );
    assert.equal(
      (
        await as(ids.other, () =>
          query(
            "select * from storage.objects where bucket_id='receipts' and name=$1",
            [doc.file],
          ),
        )
      ).length,
      0,
    );
  });
  await test("Linked receipts cannot be deleted directly from storage", async () => {
    const rows = await as(ids.member, () =>
      query(
        "delete from storage.objects where bucket_id='receipts' and name=$1 returning name",
        [doc.file],
      ),
    );
    assert.equal(rows.length, 0);
  });
  await rpc(ids.member, "ml_submit_claim", [claim]);
  await test("Submitted claims cannot be edited or have attachments removed", async () => {
    await rejected(
      () =>
        rpc(ids.member, "ml_save_claim", [
          claim,
          legacyActivity,
          "999",
          "Tampered",
          "2026-01-01",
          "Materials",
        ]),
      /own draft/,
    );
    await rejected(
      () => rpc(ids.member, "ml_remove_attachment", [doc.attachment]),
      /own draft/,
    );
  });
  await test("Members cannot review; a treasurer cannot approve their own claim", async () => {
    await rejected(
      () => rpc(ids.member, "ml_review_claim", [claim, "approved", ""]),
      /Treasurer/,
    );
    const own = await newClaim(ids.fiscal, legacyActivity, "10");
    await rpc(ids.fiscal, "ml_save_profile", [
      "Treasurer",
      "Treasurer",
      "Bank",
      "999999",
    ]);
    await receipt(ids.fiscal, own);
    await rpc(ids.fiscal, "ml_submit_claim", [own]);
    await rejected(
      () => rpc(ids.fiscal, "ml_review_claim", [own, "approved", ""]),
      /Another treasurer/,
    );
    await rpc(ids.second, "ml_review_claim", [
      own,
      "rejected",
      "Not needed for the activity",
    ]);
  });
  await rpc(ids.fiscal, "ml_review_claim", [claim, "approved", ""]);
  await test("Approval reserves budget and records an audit event", async () => {
    const a = (await rpc(ids.member, "ml_activity_summary")).find(
      (a) => a.id === legacyActivity,
    );
    assert.equal(Number(a.remaining_budget), 880);
    assert.equal(Number(a.unpaid_amount), 120);
    assert.equal(
      (
        await query(
          "select count(*)::int n from public.claim_events where claim_id=$1 and event_type='approved'",
          [claim],
        )
      )[0].n,
      1,
    );
  });
  const proofFile = await proof(ids.fiscal, claim);
  await test("Payment requires treasurer access and uploaded evidence", async () => {
    await rejected(
      () =>
        rpc(ids.member, "ml_record_payment", [
          claim,
          "2026-01-02",
          "REF",
          "invalid",
        ]),
      /Treasurer/,
    );
    await rejected(
      () =>
        rpc(ids.fiscal, "ml_record_payment", [
          claim,
          "2026-01-02",
          "REF",
          "invalid",
        ]),
      /proof/,
    );
  });
  const payment = await rpc(ids.fiscal, "ml_record_payment", [
    claim,
    "2026-01-02",
    "TEST-REF",
    proofFile,
  ]);
  await test("Payment retry is idempotent and never deducts budget twice", async () => {
    assert.equal(
      await rpc(ids.fiscal, "ml_record_payment", [
        claim,
        "2026-01-02",
        "TEST-REF",
        proofFile,
      ]),
      payment,
    );
    const a = (await rpc(ids.member, "ml_activity_summary")).find(
      (a) => a.id === legacyActivity,
    );
    assert.equal(Number(a.remaining_budget), 880);
    assert.equal(Number(a.unpaid_amount), 0);
    assert.equal(Number(a.paid_amount), 120);
    assert.equal(
      (
        await query(
          "select count(*)::int n from public.payments where claim_id=$1",
          [claim],
        )
      )[0].n,
      1,
    );
  });
  await test("Payment proof is private and immutable after recording", async () => {
    assert.equal(
      (
        await as(ids.other, () =>
          query("select * from storage.objects where name=$1", [proofFile]),
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await as(ids.member, () =>
          query("select * from storage.objects where name=$1", [proofFile]),
        )
      ).length,
      1,
    );
    assert.equal(
      (
        await as(ids.fiscal, () =>
          query("delete from storage.objects where name=$1 returning name", [
            proofFile,
          ]),
        )
      ).length,
      0,
    );
    await rejected(
      () => rpc(ids.fiscal, "ml_revoke_approval", [claim, "Changing decision"]),
      /unpaid approval/,
    );
  });
  await test("Payout changes do not rewrite the paid recipient snapshot", async () => {
    await rpc(ids.member, "ml_save_profile", [
      "Member One",
      "New Recipient",
      "Other Bank",
      "987654321",
    ]);
    assert.equal(
      (
        await query(
          "select recipient_snapshot from public.payments where id=$1",
          [payment],
        )
      )[0].recipient_snapshot.account_number,
      "123456789",
    );
    assert.equal(
      (
        await as(ids.other, () =>
          query("select * from public.payout_details where user_id=$1", [
            ids.member,
          ]),
        )
      ).length,
      0,
    );
  });
  const activity = await rpc(ids.fiscal, "ml_save_activity", [
    null,
    "Limited budget",
    "Testing budget enforcement",
    "100",
    null,
    "",
  ]);
  const first = await newClaim(ids.member, activity, "80");
  const second = await newClaim(ids.member, activity, "80");
  await receipt(ids.member, first);
  await receipt(ids.member, second);
  await rpc(ids.member, "ml_submit_claim", [first]);
  await rpc(ids.member, "ml_submit_claim", [second]);
  await test("Approvals cannot overspend the activity budget", async () => {
    await rpc(ids.fiscal, "ml_review_claim", [first, "approved", ""]);
    await rejected(
      () => rpc(ids.fiscal, "ml_review_claim", [second, "approved", ""]),
      /Insufficient budget/,
    );
    assert.equal(
      (await query("select status from public.claims where id=$1", [second]))[0]
        .status,
      "submitted",
    );
  });
  await test("Budget changes and closing an activity enforce financial constraints", async () => {
    await rejected(
      () =>
        rpc(ids.member, "ml_save_activity", [
          activity,
          "Limited budget",
          "",
          "200",
          null,
          "More funds",
        ]),
      /Treasurer/,
    );
    await rejected(
      () =>
        rpc(ids.fiscal, "ml_save_activity", [
          activity,
          "Limited budget",
          "",
          "70",
          null,
          "Less funding",
        ]),
      /lower than/,
    );
    await rejected(
      () =>
        rpc(ids.fiscal, "ml_set_activity_status", [
          activity,
          "closed",
          "Event finished",
        ]),
      /Resolve pending/,
    );
    await rpc(ids.fiscal, "ml_save_activity", [
      activity,
      "Limited budget",
      "",
      "160",
      null,
      "Additional allocation",
    ]);
    await rpc(ids.fiscal, "ml_review_claim", [second, "approved", ""]);
    assert.equal(
      Number(
        (await rpc(ids.member, "ml_activity_summary")).find(
          (a) => a.id === activity,
        ).remaining_budget,
      ),
      0,
    );
  });
  await test("Rejection, revision and resubmission preserve history", async () => {
    const c = await newClaim(ids.member, legacyActivity, "20");
    await receipt(ids.member, c);
    await rpc(ids.member, "ml_submit_claim", [c]);
    await rpc(ids.fiscal, "ml_review_claim", [
      c,
      "rejected",
      "Please clarify the description",
    ]);
    await rpc(ids.member, "ml_return_to_draft", [c]);
    await rejected(
      () => rpc(ids.member, "ml_delete_claim", [c]),
      /retained for history/,
    );
    await rpc(ids.member, "ml_save_claim", [
      c,
      legacyActivity,
      "20",
      "Clear description",
      "2026-01-01",
      "Materials",
    ]);
    await rpc(ids.member, "ml_submit_claim", [c]);
    assert.equal(
      (
        await query(
          "select count(*)::int n from public.claim_events where claim_id=$1 and event_type='submitted'",
          [c],
        )
      )[0].n,
      2,
    );
  });
  await test("Only an unsubmitted, attachment-free own draft can be deleted", async () => {
    const c = await newClaim(ids.member, legacyActivity, "5");
    const file = await receipt(ids.member, c);
    await rejected(() => rpc(ids.other, "ml_delete_claim", [c]), /own draft/);
    await rejected(
      () => rpc(ids.member, "ml_delete_claim", [c]),
      /remove its attachments/,
    );
    await rpc(ids.member, "ml_remove_attachment", [file.attachment]);
    await as(ids.member, () =>
      query("delete from storage.objects where name=$1", [file.file]),
    );
    await rpc(ids.member, "ml_delete_claim", [c]);
    assert.equal(
      (await query("select * from public.claims where id=$1", [c])).length,
      0,
    );
  });
  await db.exec(
    await readFile(
      path.join(root, "supabase/migrations/007_president_view.sql"),
      "utf8",
    ),
  );
  await query("update public.profiles set role='president' where id=$1", [
    ids.other,
  ]);
  await test("President endpoint rejects Member, Treasurer and anonymous callers", async () => {
    for (const user of [ids.member, ids.fiscal, null]) {
      await rejected(
        () => rpc(user, "ml_president_overview"),
        /President access|required|Sign in/i,
      );
    }
    await db.exec("begin; set local role anon;");
    try {
      await rejected(
        () => query("select public.ml_president_overview()"),
        /permission denied/,
      );
    } finally {
      await db.exec("rollback");
    }
  });
  await test("President overview returns accurate budgets and safe non-draft summaries", async () => {
    const snapshot = await rpc(ids.other, "ml_president_overview");
    const expected = await query(
      "select count(*)::int n from public.claims where status<>'draft'",
    );
    assert.equal(snapshot.claim_count, expected[0].n);
    assert.equal(snapshot.claims.length, Math.min(expected[0].n, 500));
    for (const c of snapshot.claims) {
      assert.notEqual(c.status, "draft");
      assert.deepEqual(
        Object.keys(c).sort(),
        [
          "id",
          "claimant_name",
          "activity_id",
          "activity_name",
          "amount",
          "description",
          "status",
          "submitted_at",
        ].sort(),
      );
    }
    const totals = await query(
      "select a.id,a.budget-coalesce(sum(c.amount) filter(where c.status in ('approved','paid')),0) remaining from public.activities a left join public.claims c on c.activity_id=a.id group by a.id",
    );
    for (const a of snapshot.activities)
      assert.equal(
        Number(a.remaining_budget),
        Number(totals.find((t) => t.id === a.id).remaining),
      );
  });
  await test("President does not inherit Treasurer writes or private record access", async () => {
    await rejected(
      () => rpc(ids.other, "ml_review_claim", [legacyClaim, true, null]),
      /Treasurer access/,
    );
    const foreignClaims = await as(ids.other, () =>
      query("select * from public.claims where claimant_id<>$1", [ids.other]),
    );
    assert.equal(foreignClaims.length, 0);
    const foreignPayouts = await as(ids.other, () =>
      query("select * from public.payout_details where user_id<>$1", [
        ids.other,
      ]),
    );
    assert.equal(foreignPayouts.length, 0);
    const draft = await newClaim(ids.other, legacyActivity, "2");
    assert.ok(draft);
    await rpc(ids.other, "ml_delete_claim", [draft]);
  });
  await db.exec(
    await readFile(
      path.join(root, "supabase/migrations/008_budget_approval.sql"),
      "utf8",
    ),
  );
  let proposal;
  let fundedActivity;
  await test("Only Treasurer can propose budgets; private requests reject Member access", async () => {
    for (const who of [ids.member, ids.other])
      await rejected(
        () =>
          rpc(who, "ml_save_activity", [
            null,
            "New event",
            "",
            "500",
            null,
            "Materials allocation",
          ]),
        /Treasurer/,
      );
    await rejected(
      () => rpc(ids.member, "ml_list_budget_requests"),
      /access required/,
    );
    await rejected(
      () => as(ids.fiscal, () => query("select * from public.budget_requests")),
      /permission denied/,
    );
    await rejected(
      () =>
        as(ids.fiscal, () =>
          query("update public.activities set budget=99999"),
        ),
      /permission denied/,
    );
    proposal = await rpc(ids.fiscal, "ml_save_activity", [
      null,
      "Approval event",
      "Requested event",
      "500",
      null,
      "Materials allocation",
    ]);
    assert.equal(
      (
        await query(
          "select * from public.activities where name='Approval event'",
        )
      ).length,
      0,
    );
    assert.ok(
      (await rpc(ids.other, "ml_list_budget_requests")).some(
        (r) => r.id === proposal,
      ),
    );
  });
  await test("President approval creates an activity once and records the decision", async () => {
    await rejected(
      () => rpc(ids.fiscal, "ml_decide_budget", [proposal, true, ""]),
      /President/,
    );
    await rejected(
      () => rpc(ids.member, "ml_decide_budget", [proposal, true, ""]),
      /President/,
    );
    await rpc(ids.other, "ml_decide_budget", [
      proposal,
      true,
      "Approved for event",
    ]);
    const r = (
      await query("select * from public.budget_requests where id=$1", [
        proposal,
      ])
    )[0];
    fundedActivity = r.activity_id;
    assert.equal(r.status, "approved");
    assert.equal(r.reviewed_by, ids.other);
    assert.equal(
      Number(
        (
          await query("select budget from public.activities where id=$1", [
            fundedActivity,
          ])
        )[0].budget,
      ),
      500,
    );
    await rejected(
      () => rpc(ids.other, "ml_decide_budget", [proposal, true, ""]),
      /no longer pending/,
    );
    assert.equal(
      (
        await query(
          "select * from public.activity_events where activity_id=$1",
          [fundedActivity],
        )
      ).length,
      1,
    );
    const draft = await newClaim(ids.member, fundedActivity, "5");
    await rpc(ids.member, "ml_delete_claim", [draft]);
  });
  await test("Budget updates remain pending, prevent duplicates, and apply approved totals", async () => {
    const r = await rpc(ids.fiscal, "ml_save_activity", [
      fundedActivity,
      "Approval event",
      "Requested event",
      "700",
      null,
      "Additional materials",
    ]);
    assert.equal(
      Number(
        (
          await query("select budget from public.activities where id=$1", [
            fundedActivity,
          ])
        )[0].budget,
      ),
      500,
    );
    await rejected(
      () =>
        rpc(ids.second, "ml_save_activity", [
          fundedActivity,
          "Approval event",
          "",
          "800",
          null,
          "Another request",
        ]),
      /already has a pending/,
    );
    await rpc(ids.other, "ml_decide_budget", [
      r,
      true,
      "Additional funding approved",
    ]);
    assert.equal(
      Number(
        (
          await query("select budget from public.activities where id=$1", [
            fundedActivity,
          ])
        )[0].budget,
      ),
      700,
    );
  });
  await test("Rejections require reasons and keep budgets and request history", async () => {
    const r = await rpc(ids.fiscal, "ml_save_activity", [
      fundedActivity,
      "Approval event",
      "",
      "900",
      null,
      "More resources",
    ]);
    await rejected(
      () => rpc(ids.other, "ml_decide_budget", [r, false, ""]),
      /Rejection requires/,
    );
    await rpc(ids.other, "ml_decide_budget", [r, false, "Allocation too high"]);
    assert.equal(
      Number(
        (
          await query("select budget from public.activities where id=$1", [
            fundedActivity,
          ])
        )[0].budget,
      ),
      700,
    );
    assert.equal(
      (
        await query(
          "select review_note from public.budget_requests where id=$1",
          [r],
        )
      )[0].review_note,
      "Allocation too high",
    );
  });
  await test("Only requesting Treasurer can cancel; cancelled requests cannot be approved", async () => {
    const r = await rpc(ids.fiscal, "ml_save_activity", [
      fundedActivity,
      "Approval event",
      "",
      "800",
      null,
      "Temporary request",
    ]);
    await rejected(
      () => rpc(ids.second, "ml_cancel_budget", [r]),
      /own pending/,
    );
    await rejected(() => rpc(ids.other, "ml_cancel_budget", [r]), /Treasurer/);
    await rpc(ids.fiscal, "ml_cancel_budget", [r]);
    await rejected(
      () => rpc(ids.other, "ml_decide_budget", [r, true, ""]),
      /no longer pending/,
    );
    const replacement = await rpc(ids.fiscal, "ml_save_activity", [
      fundedActivity,
      "Approval event",
      "",
      "800",
      null,
      "Replacement request",
    ]);
    await rpc(ids.fiscal, "ml_cancel_budget", [replacement]);
  });
  await test("Self review stays forbidden even after requester becomes President", async () => {
    const r = await rpc(ids.second, "ml_save_activity", [
      null,
      "Self review event",
      "",
      "100",
      null,
      "Test self review",
    ]);
    await query("update public.profiles set role='president' where id=$1", [
      ids.second,
    ]);
    await rejected(
      () => rpc(ids.second, "ml_decide_budget", [r, true, ""]),
      /own request/,
    );
    await rpc(ids.other, "ml_decide_budget", [
      r,
      false,
      "Use another proposal",
    ]);
    await query("update public.profiles set role='treasurer' where id=$1", [
      ids.second,
    ]);
  });
  await test("Budget approval rechecks expenditure committed after request submission", async () => {
    const r = await rpc(ids.fiscal, "ml_save_activity", [
      fundedActivity,
      "Approval event",
      "",
      "100",
      null,
      "Reduced attendance",
    ]);
    const c = await newClaim(ids.member, fundedActivity, "150");
    await receipt(ids.member, c);
    await rpc(ids.member, "ml_submit_claim", [c]);
    await rpc(ids.fiscal, "ml_review_claim", [c, "approved", ""]);
    await rejected(
      () => rpc(ids.other, "ml_decide_budget", [r, true, ""]),
      /lower than approved/,
    );
    assert.equal(
      (
        await query("select status from public.budget_requests where id=$1", [
          r,
        ])
      )[0].status,
      "pending",
    );
    await rpc(ids.other, "ml_decide_budget", [
      r,
      false,
      "Existing approved expenditure exceeds this proposal",
    ]);
    await rejected(
      () =>
        rpc(ids.fiscal, "ml_save_activity", [
          fundedActivity,
          "Approval event",
          "",
          "100",
          null,
          "Try again",
        ]),
      /lower than approved/,
    );
  });
  console.log(
    `\n${count} database workflow/security checks passed. No remote Supabase project was used.`,
  );
} finally {
  await db.close();
}
