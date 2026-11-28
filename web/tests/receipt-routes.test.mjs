import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import { reading, selection, subtotalReading, itemAnswers } from "./fixtures/receipt.mjs";
const require = createRequire(import.meta.url);
async function load(file, imports = {}) {
  const m = new Module(path.resolve(file)); m.filename = path.resolve(file); m.paths = require.resolve.paths("typescript");
  m.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, m.filename);
  return m.exports;
}
const core = await load("src/lib/ai/receipt-allocation.ts");
const domain = await load("src/lib/domain.ts");
const server = await load("src/lib/ai/receipt-server.ts", { "server-only": {}, "@supabase/supabase-js": {} });
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", claimId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const bytes = Buffer.from([137,80,78,71,13,10,26,10,0,0]);
async function fixture({ auth = true, owns = true, mismatch = false, finishError = false, status = "complete", readFailure = false, receipt = reading } = {}) {
  const calls = [];
  const session = { id: sessionId, user_id: userId, activity_id: "activity", claim_id: null, status, expires_at: "2099-01-01T00:00:00Z", extraction: receipt, mime_type: "image/png", original_name: "receipt.png", storage_path: `${userId}/${sessionId}/source.png`, sha256: createHash("sha256").update(bytes).digest("hex") };
  function query(table) {
    const filters = {};
    const q = { select: () => q, eq: (key, value) => { filters[key] = value; return q; }, is: () => q, lt: () => q, in: () => q, delete: () => q,
      update: value => { calls.push(["update", table, value]); return q; },
      limit: async () => ({ data: [] }),
      single: async () => ({ data: table === "receipt_drafts" ? owns && filters.user_id !== "forbidden" ? session : null : table === "activities" ? { name: "Workshop", description: "Robotics" } : { id: sessionId } }),
      maybeSingle: async () => ({ data: null }),
    };
    return q;
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: auth ? { id: userId } : null } }) }, from: query,
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      if (name === "ml_prepare_receipt_claim") return { data: claimId };
      if (name === "ml_finish_receipt_claim") return finishError ? { error: { message: "Draft changed; reload it." } } : { data: claimId };
      if (name === "ml_receipt_draft_duplicates") return { data: { other_matches: 1, own_matches: [] } };
      if (name === "ml_begin_receipt_read") return { data: "run-id" };
      throw new Error(name);
    },
    storage: { from: bucket => ({
      download: async name => { calls.push(["download", bucket, name]); return { data: new Blob([mismatch ? Buffer.concat([bytes, Buffer.from("changed")]) : bytes]) }; },
      upload: async (name, value) => { calls.push(["upload", bucket, name, value.length]); return {}; },
      remove: async names => { calls.push(["remove", bucket, names]); return {}; },
    }) },
  };
  const imports = { "@/lib/supabase/server": { createServerSupabaseClient: async () => client }, "@/lib/ai/receipt-allocation": core,
    "@/lib/ai/receipt-server": { ...server, receiptAdmin: () => client }, "@/lib/domain": domain,
    "@/lib/ai/receipt-reader": { readReceiptDraft: async (...args) => { calls.push(["read", args[2].bytes.length]);
      if (readFailure) throw Object.assign(new Error("Gemini is temporarily busy or unavailable (HTTP 503). Try again shortly."), { name: "ReceiptAiError", httpStatus: 503, diagnostic: { providerHttpStatus: 503, providerStatus: "UNAVAILABLE", attempts: 3 } });
      return receipt; } },
  };
  const save = (await load("src/app/api/receipt-drafts/[id]/save/route.ts", imports)).POST;
  const extract = (await load("src/app/api/receipt-drafts/[id]/extract/route.ts", imports)).POST;
  const body = { claimId: null, revision: 0, selection, calculation: { expected_amount: "999.00" }, extraction: { total: "999.00" }, fields: { amount: "85.00", purchase_date: "2026-11-20", category: "Materials", description: "Workshop supplies" } };
  const run = (kind, data = body, origin = "http://localhost:3000", consent = "yes") => (kind === "save" ? save : extract)(new Request(`http://localhost:3000/api/receipt-drafts/${sessionId}/${kind}`, { method: "POST", headers: { origin, "x-moneylai-ai-consent": consent }, body: kind === "save" ? JSON.stringify(data) : undefined }), { params: Promise.resolve({ id: sessionId }) });
  return { run, calls, body };
}
test("Save recomputes the selected amount from server-owned facts and retains a manual claim difference", async () => {
  const f = await fixture();
  const response = await f.run("save");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const finished = f.calls.find(c => c[1] === "ml_finish_receipt_claim")[2];
  assert.equal(finished.p_calculation.expected_amount, "80.00");
  assert.equal(finished.p_fields.amount, "85.00");
  assert.equal(finished.p_user, userId);
  assert.ok(f.calls.some(c => c[0] === "upload" && c[2] === `${userId}/${claimId}/${sessionId}.png`));
});
test("New receipt modes save server-recalculated totals and treatment; inconsistent claim amounts are rejected", async () => {
  for (const mode of ["full", "auto", "simple"]) {
    const f = await fixture();
    const chosen = { ...core.initialSelection(reading, mode), confirmed: true, items: reading.items.map(i => ({ id: i.id, included: true, amount: i.amount, reason: "Activity purchase" })) };
    const body = { ...f.body, selection: chosen, fields: { ...f.body.fields, amount: "100.00" } };
    assert.equal((await f.run("save", { ...body, fields: { ...body.fields, amount: "999.00" } })).status, 400);
    assert.equal(f.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
    assert.equal((await f.run("save", body)).status, 200);
    const saved = f.calls.find(c => c[1] === "ml_finish_receipt_claim")[2];
    assert.equal(saved.p_calculation.expected_amount, "100.00"); assert.equal(saved.p_selection.mode, mode);
    assert.equal(saved.p_selection.adjustment_treatment.tax, "included");
    if (mode === "full") assert.equal(saved.p_calculation.tax, null);
  }
});

test("Simple reimbursement overrides are validated and preserve automatic evidence on the server", async () => {
  const f = await fixture();
  const chosen = { ...core.initialSelection(reading, "simple"), items: selection.items, confirmed: true, claimed_amount: "85.00", override_reason: "Checked actual activity share on the receipt." };
  assert.equal((await f.run("save", { ...f.body, selection: { ...chosen, override_reason: "" } })).status, 400);
  assert.equal((await f.run("save", { ...f.body, selection: { ...chosen, claimed_amount: "0.00" }, fields: { ...f.body.fields, amount: "0.00" } })).status, 400);
  assert.equal(f.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
  assert.equal((await f.run("save", { ...f.body, selection: chosen })).status, 200);
  const saved = f.calls.find(c => c[1] === "ml_finish_receipt_claim")[2];
  assert.equal(saved.p_selection.claimed_amount, "85.00");
  assert.equal(saved.p_calculation.automatic_amount, "80.00");
  assert.equal(saved.p_calculation.expected_amount, "85.00");
  assert.match(saved.p_calculation.correction_reason, /actual activity share/);
});

test("Save requires all item purposes and exclusion reasons even when a fallback amount is confirmed", async () => {
  for (const mode of ["full", "simple", "auto"]) {
    for (const included of mode === "full" ? [true] : [true, false]) {
      const f = await fixture();
      const chosen = { ...core.initialSelection(reading, mode), items: itemAnswers(reading.items), confirmed: true };
      chosen.items[0] = { ...chosen.items[0], included, reason: " " };
      if (mode === "simple") { chosen.claimed_amount = "70.00"; chosen.override_reason = "Confirmed from the original receipt"; }
      const response = await f.run("save", { ...f.body, selection: chosen });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, included ? /activity purpose/ : /excluded/);
      assert.equal(f.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
    }
  }
});

test("Save accepts higher and lower member corrections and preserves the AI facts and reason", async () => {
  for (const claimed_amount of ["116.20", "108.20"]) {
    const f = await fixture({ receipt: subtotalReading });
    const chosen = { ...core.initialSelection(subtotalReading, "simple"), items: itemAnswers(subtotalReading.items), confirmed: true,
      claimed_amount, override_reason: "The AI misread the amount. Check the original receipt." };
    const body = { ...f.body, selection: chosen, fields: { ...f.body.fields, amount: claimed_amount } };
    assert.equal((await f.run("save", { ...body, selection: { ...chosen, override_reason: "" } })).status, 400);
    assert.equal(f.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
    assert.equal((await f.run("save", body)).status, 200);
    const saved = f.calls.find(c => c[1] === "ml_finish_receipt_claim")[2];
    assert.equal(saved.p_calculation.expected_amount, claimed_amount);
    assert.equal(saved.p_calculation.automatic_amount, "112.20");
    assert.equal(saved.p_calculation.raw_receipt_total, "112.20");
    assert.equal(saved.p_calculation.receipt_total, "112.20");
    assert.equal(saved.p_fields.amount, claimed_amount); assert.equal(saved.p_selection.override_reason, chosen.override_reason);
    if (claimed_amount === "116.20") assert.ok(saved.p_calculation.issues.some(i => i.includes("exceeds the AI-read receipt total by RM 4.00")));
  }
});

test("Save applies default receipt tax allocation and preserves explicit mixed-tax evidence", async () => {
  const receipt = { ...reading, total: "106.00", tax: "6.00", line_amount_basis: "net",
    items: [{ ...reading.items[0], amount: "60.00" }, { ...reading.items[1], amount: "40.00" }],
    adjustment_treatment: { tax: "additional", discount: "none", rounding: "none", uniform: false, tax_scope: "unknown" } };
  const chosen = { ...core.initialSelection(receipt, "simple"), items: itemAnswers(receipt.items), confirmed: true };
  chosen.items[1].included = false; chosen.items[1].reason = "Personal";
  const f = await fixture({ receipt });
  const body = { ...f.body, selection: chosen, fields: { ...f.body.fields, amount: "63.60" } };
  assert.equal((await f.run("save", body)).status, 200);
  const saved = f.calls.find(c => c[1] === "ml_finish_receipt_claim")[2];
  assert.equal(saved.p_calculation.expected_amount, "63.60"); assert.equal(saved.p_calculation.tax, "3.60");
  assert.equal(saved.p_calculation.automatic_issue, null);
  assert.match(saved.p_calculation.adjustment_reason, /tax is allocated across all items/);
  assert.equal(saved.p_selection.adjustment_treatment.tax_scope, "unknown");
  const mixed = await fixture({ receipt: { ...receipt, adjustment_treatment: { ...receipt.adjustment_treatment, tax_scope: "mixed" } } });
  // Even a client claiming uniform tax cannot override the original reading.
  assert.equal((await mixed.run("save", { ...body, selection: { ...chosen, adjustment_treatment: { ...chosen.adjustment_treatment, uniform: true, tax_scope: "all_items" } } })).status, 400);
  assert.equal(mixed.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
});

test("Invalid selections fail before preparing a claim; changed original bytes cannot be attached", async () => {
  const f = await fixture();
  assert.equal((await f.run("save", { ...f.body, selection: { ...selection, confirmed: false } })).status, 400);
  assert.equal(f.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
  const changed = await fixture({ mismatch: true });
  const response = await changed.run("save");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).claimId, claimId); // Recover the retained draft.
  assert.equal(changed.calls.some(c => c[1] === "ml_finish_receipt_claim"), false);
});

test("Save accepts reconciled subtotals and explicitly confirmed fallback amounts with their audit trail", async () => {
  for (const total of ["112.20", "113.20"]) {
    const receipt = { ...subtotalReading, total }, f = await fixture({ receipt });
    let chosen = { ...core.initialSelection(receipt, "simple"), items: itemAnswers(receipt.items), confirmed: true };
    chosen.items[1].included = false; chosen.items[1].reason = "Personal";
    const body = { ...f.body, selection: chosen, fields: { ...f.body.fields, amount: "84.30" } };
    if (total === "113.20") {
      assert.equal((await f.run("save", body)).status, 400);
      assert.equal(f.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
      chosen = core.confirmSelectedItemAmount(chosen);
    }
    assert.equal((await f.run("save", { ...body, selection: chosen })).status, 200);
    const saved = f.calls.find(c => c[1] === "ml_finish_receipt_claim")[2];
    assert.equal(saved.p_calculation.expected_amount, "84.30");
    assert.equal(saved.p_calculation.selected_subtotal, "84.30"); assert.equal(saved.p_calculation.excluded_subtotal, "27.90");
    if (total === "112.20") assert.equal(saved.p_calculation.automatic_amount, "84.30");
    else {
      assert.equal(saved.p_calculation.automatic_amount, null); assert.equal(saved.p_calculation.tax, null);
      assert.match(saved.p_calculation.automatic_issue, /tax/);
      assert.equal(saved.p_selection.override_reason, chosen.override_reason);
      assert.match(saved.p_calculation.correction_reason, /84.30.*27.90/);
    }
  }
});
test("Receipt routes reject unauthenticated, foreign-session and cross-origin requests", async () => {
  for (const [options, status] of [[{ auth: false }, 401], [{ owns: false }, 409]]) {
    const f = await fixture(options);
    assert.equal((await f.run("save")).status, status);
    assert.equal(f.calls.some(c => c[1] === "ml_prepare_receipt_claim"), false);
  }
  const f = await fixture();
  assert.equal((await f.run("save", f.body, "https://other.example")).status, 403);
  assert.equal((await f.run("extract", null, "http://localhost:3000", "no")).status, 400);
  assert.equal(f.calls.length, 0);
});
test("A completed reading is cached, and a failed final commit leaves temporary evidence recoverable", async () => {
  const cached = await fixture();
  assert.equal((await cached.run("extract")).status, 200);
  assert.equal(cached.calls.some(c => c[0] === "read"), false);
  const f = await fixture({ finishError: true });
  const response = await f.run("save");
  assert.equal(response.status, 409); assert.equal((await response.json()).claimId, claimId);
  assert.equal(f.calls.some(c => c[0] === "remove"), false);
});
test("A new extraction verifies private bytes, stores the raw reading and performs sanitized duplicate lookup", async () => {
  const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test-key"; process.env.GEMINI_MODEL = "test-model";
  try {
    const f = await fixture({ status: "pending" });
    const response = await f.run("extract");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).duplicates.other_matches, 1);
    assert.ok(f.calls.some(c => c[0] === "read" && c[1] === bytes.length));
    assert.ok(f.calls.some(c => c[0] === "update" && c[1] === "receipt_drafts" && c[2].status === "complete" && c[2].extraction.total === "100.00"));
  } finally {
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
    if (model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = model;
  }
});
test("Provider overload returns 503 rather than an internal error or misleading configuration message", async () => {
  const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL, originalLog = console.error;
  process.env.GEMINI_API_KEY = "test-key"; process.env.GEMINI_MODEL = "test-model";
  const logs = []; console.error = (...args) => logs.push(args);
  try {
    const f = await fixture({ status: "pending", readFailure: true });
    const response = await f.run("extract");
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /temporarily busy/);
    assert.ok(f.calls.some(c => c[0] === "update" && c[1] === "receipt_drafts" && c[2].status === "failed"));
    assert.equal(logs[0][1].providerHttpStatus, 503);
  } finally {
    console.error = originalLog;
    if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key;
    if (model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = model;
  }
});
test("Treasurer cross-check rereads the original and reports an inflated claim against its item allocation", async () => {
  const names = ["GEMINI_API_KEY", "GEMINI_MODEL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"];
  const env = names.map(n => process.env[n]);
  names.forEach(n => { process.env[n] = n === "NEXT_PUBLIC_SUPABASE_URL" ? "https://test.example" : "test-value"; });
  try {
    const checks = await load("src/lib/ai/claim-check.ts");
    const calculation = core.calculateAllocation(reading, selection);
    const plan = { claim_id: claimId, attachment_id: "receipt-id", revision: 3, extraction: reading, selection, calculation, sha256: createHash("sha256").update(bytes).digest("hex") };
    const claim = { id: claimId, claimant_id: "another-member", activity_id: "activity", status: "submitted", amount: "85.00", purchase_date: reading.date, category: "Materials", description: "Workshop supplies" };
    const file = { id: "receipt-id", kind: "receipt", mime_type: "image/png", size_bytes: bytes.length, storage_path: "private/original.png" };
    let saved, freshReads = 0;
    const table = name => {
      const q = { select: () => q, eq: () => q, single: async () => ({ data: name === "claims" ? claim : { name: "Workshop", description: "Robotics" } }),
        maybeSingle: async () => ({ data: plan }), order: async () => ({ data: [file] }),
        upsert: async () => ({}), update: value => { if (value.result) saved = value; return q; }, then: resolve => resolve({ error: null }),
      };
      return q;
    };
    const client = { auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, from: table,
      rpc: async () => ({ data: "run" }), storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]) }) }) } };
    const route = await load("src/app/api/claims/[id]/ai-check/route.ts", {
      "@supabase/supabase-js": { createClient: () => client }, "@/lib/supabase/server": { createServerSupabaseClient: async () => client },
      "@/lib/ai/claim-check": checks, "@/lib/ai/receipt-allocation": core,
      "@/lib/ai/gemini": { readReceipts: async () => { throw new Error("Wrong review path"); } },
      "@/lib/ai/receipt-reader": { readReceiptDraft: async (_, __, original, ___, finalClaim) => { freshReads++; assert.equal(original.bytes.length, bytes.length); assert.equal(finalClaim.description, claim.description); return reading; } },
    });
    const response = await route.POST(new Request(`http://localhost:3000/api/claims/${claimId}/ai-check`, { method: "POST", headers: { origin: "http://localhost:3000", "x-moneylai-ai-consent": "yes" } }), { params: Promise.resolve({ id: claimId }) });
    assert.equal(response.status, 200);
    assert.equal(freshReads, 1);
    assert.equal(saved.result.amount_status, "mismatch");
    assert.equal(saved.result.receipt_total, "100.00");
    assert.equal(saved.result.allocation.expected_amount, "80.00");
    assert.equal(saved.result.allocation.difference, "5.00");
    assert.ok(saved.result.needs_attention);
  } finally { names.forEach((n, i) => { if (env[i] === undefined) delete process.env[n]; else process.env[n] = env[i]; }); }
});
