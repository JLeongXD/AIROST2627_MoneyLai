import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Module } from "node:module";
import path from "node:path";
import ts from "typescript";
const source = await readFile(new URL("../src/app/api/activities/[id]/export/route.ts", import.meta.url), "utf8");
const activityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function fixture({ role = "treasurer", signedError = false, auth = true, rpcError = null } = {}) {
  const calls = [];
  class ExportLimitError extends Error {}
  const storage = {
    list: async (...args) => { calls.push(["list", ...args]); return { data: [] }; },
    upload: async (...args) => { calls.push(["upload", ...args]); return {}; },
    remove: async (...args) => { calls.push(["remove", ...args]); return {}; },
    createSignedUrl: async (...args) => { calls.push(["sign", ...args]); return signedError ? { error: true } : { data: { signedUrl: "https://storage.example/signed" } }; },
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: auth ? { id: userId } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role } }) }) }) }),
    rpc: async (...args) => { calls.push(["rpc", ...args]); return { data: { scope: "treasurer_evidence" }, error: rpcError }; },
    storage: { from: bucket => { calls.push(["bucket", bucket]); return storage; } },
  };
  const mod = new Module("export-route-test");
  mod.filename = path.resolve("tests/export-route-test.cjs");
  mod.require = name => {
    if (name === "@/lib/supabase/server") return { createServerSupabaseClient: async () => client };
    if (name === "@/lib/reports/activity-pack") return { ExportLimitError, buildActivityPack: async snapshot => {
      calls.push(["build", snapshot.scope]); return { bytes: new Uint8Array([1, 2, 3]), filename: "activity.zip", issues: 0 };
    } };
    throw new Error(`Unexpected import: ${name}`);
  };
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, mod.filename);
  const run = (origin = "http://localhost:3000", id = activityId) => mod.exports.POST(new Request(`http://localhost:3000/api/activities/${id}/export`, { method: "POST", headers: { origin } }), { params: Promise.resolve({ id }) });
  return { run, calls };
}
test("Export route requires a session, an allowed role and a same-origin valid activity", async () => {
  for (const [options, status] of [[{ auth: false }, 401], [{ role: "member" }, 403]]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, status);
    assert.equal(f.calls.some(c => c[0] === "build"), false);
  }
  const f = fixture();
  assert.equal((await f.run("https://other.example")).status, 403);
  assert.equal((await f.run("http://localhost:3000", "bad-id")).status, 400);
  assert.equal(f.calls.length, 0);
});
test("Export returns a small private response, scopes president data and uses an expiring own-folder link", async () => {
  const f = fixture({ role: "president" });
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.url, "https://storage.example/signed");
  assert.match(result.path, new RegExp(`^${userId}/[a-f0-9-]+\\.zip$`));
  assert.ok(f.calls.some(c => c[0] === "build" && c[1] === "president_summary"));
  assert.deepEqual(f.calls.find(c => c[0] === "sign"), ["sign", result.path, 120, { download: "activity.zip" }]);
  assert.ok(f.calls.some(c => c[0] === "upload" && c[3].contentType === "application/zip"));
});
test("Export cleans failed signed downloads and explains a missing migration", async () => {
  const f = fixture({ signedError: true });
  assert.equal((await f.run()).status, 500);
  assert.equal(f.calls.filter(c => c[0] === "remove").length, 1);
  const missing = fixture({ rpcError: { code: "PGRST202", message: "missing" } });
  const response = await missing.run();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /012_activity_exports_only.sql/);
});
