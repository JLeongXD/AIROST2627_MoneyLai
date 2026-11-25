import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import { reading, selection } from "./fixtures/receipt.mjs";
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
async function fixture({ auth = true, owns = true, mismatch = false, finishError = false, status = "complete", readFailure = false } = {}) {
  const calls = [];
  const session = { id: sessionId, user_id: userId, activity_id: "activity", claim_id: null, status, expires_at: "2099-01-01T00:00:00Z", extraction: reading, mime_type: "image/png", original_name: "receipt.png", storage_path: `${userId}/${sessionId}/source.png`, sha256: createHash("sha256").update(bytes).digest("hex") };
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
      return reading; } },
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
