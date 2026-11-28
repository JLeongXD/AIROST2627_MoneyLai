import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import { createBrowserClient } from "@supabase/ssr";
const require = createRequire(import.meta.url);
async function load(file, imports = {}) {
  const mod = new Module(path.resolve(file)); mod.filename = path.resolve(file); mod.paths = require.resolve.paths("typescript");
  mod.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  mod._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, mod.filename);
  return mod.exports;
}
const { browserFetch } = await load("src/lib/browser-fetch.ts");
const { saveClaimDraft } = await load("src/lib/claim-draft.ts");

test("Real Supabase SDK fails with unbound native fetch, then saves and refreshes through the bound app client", async () => {
  const saved = { window: globalThis.window, fetch: globalThis.fetch, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  const calls = [], clients = [];
  const member = "11111111-1111-4111-8111-111111111111";
  const browserWindow = { location: { pathname: "/claims/new" } };
  browserWindow.fetch = async function(input, init) {
    assert.equal(this, browserWindow, "Can only call Window.fetch on instances of Window");
    const route = new URL(input, "https://moneylai.test").pathname; calls.push(route);
    if (route === "/api/receipt-drafts/session/save") return Response.json({ claimId: "draft" });
    if (route === "/rest/v1/claims") return Response.json([{ id: "draft", amount: "21.00" }]);
    if (route === "/rest/v1/attachments") return Response.json([{ id: "receipt", kind: "receipt" }]);
    if (route === "/rest/v1/claim_receipt_plans") return Response.json([{ revision: 1 }]);
    if (route === "/rest/v1/rpc/ml_save_claim") return Response.json("draft");
    if (route === "/auth/v1/user") return Response.json({ id: member });
    if (route === "/storage/v1/object/receipts/test.png") return Response.json({ Key: "receipts/test.png" });
    throw new Error("Unexpected mock route: " + route);
  };
  const realClient = (url, key, options = {}) => {
    const client = createBrowserClient(url, key, { ...options, isSingleton: false,
      auth: { ...options.auth, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      cookies: { getAll: () => [], setAll: () => {} } });
    clients.push(client); return client;
  };
  try {
    globalThis.window = browserWindow; globalThis.fetch = browserWindow.fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
    // Old production configuration reproduces the same post-save read error.
    const old = realClient("https://test.supabase.co", "test-key");
    assert.match((await old.from("claims").select("*")).error.message, /Window.fetch/);
    const factory = await load("src/lib/supabase/client.ts", {
      "@supabase/ssr": { createBrowserClient: realClient }, "../browser-fetch": { browserFetch },
    });
    const client = factory.createClient();
    const unwrap = async query => { const { data, error } = await query; if (error) throw error; return data; };
    const progress = { id: null, uploadedFile: null, revision: 0 };
    const result = await saveClaimDraft({ activityId: "activity", amount: "21.00", purchaseDate: "2026-11-20", category: "Materials", description: "Workshop" },
      null, { sessionId: "session", selection: {} }, progress, {
        fetch: browserFetch, claim: async id => (await unwrap(client.from("claims").select("*").eq("id", id)))[0],
        attachments: id => unwrap(client.from("attachments").select("*").eq("claim_id", id)),
        plan: id => unwrap(client.from("claim_receipt_plans").select("*").eq("claim_id", id).maybeSingle()),
      });
    assert.equal(result.claim.id, "draft"); assert.equal(progress.revision, 1); assert.equal(result.attachments.length, 1);
    for (const route of ["/api/receipt-drafts/session/save", "/rest/v1/claims", "/rest/v1/attachments", "/rest/v1/claim_receipt_plans"]) assert.ok(calls.includes(route));
    assert.equal(await unwrap(client.rpc("ml_save_claim", {})), "draft");
    assert.equal((await client.auth.getUser("test-jwt")).data.user.id, member);
    assert.equal((await client.storage.from("receipts").upload("test.png", new Blob(["test"]), { contentType: "image/png" })).error, null);
    // The helper is safe when detached and when invoked through an arbitrary object.
    const detached = browserFetch; await detached("/api/receipt-drafts/session/save");
    await ({ request: browserFetch }).request("/api/receipt-drafts/session/save");
    delete globalThis.window;
    globalThis.fetch = async function() { assert.equal(this, globalThis); return Response.json({ ok: true }); };
    assert.equal((await browserFetch("https://moneylai.test")).status, 200);
  } finally {
    await Promise.all(clients.map(client => client.auth.stopAutoRefresh()));
    globalThis.window = saved.window; globalThis.fetch = saved.fetch;
    for (const [key, value] of [["NEXT_PUBLIC_SUPABASE_URL", saved.url], ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", saved.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
