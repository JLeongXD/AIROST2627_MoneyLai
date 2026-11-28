import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function load(file, imports = {}) {
  const m = new Module(path.resolve(file)); m.filename = path.resolve(file);
  m.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, m.filename);
  return m.exports;
}
const { verifyInvitationSession } = await load("src/lib/members/invitation-session.ts");
const token = "22222222-2222-4222-8222-222222222222";
const link = `https://moneylai.example/join?invitation=${token}`;
function fixture({ denied = false, authError = false, signedOut = false, returnedId } = {}) {
  let user = signedOut ? null : { id: "president", email: "president@example.com" };
  const calls = [], scrubbed = [];
  const auth = {
    setSession: async credentials => {
      calls.push(["setSession", credentials]);
      if (authError) return { data: { user: null }, error: new Error("invalid token") };
      user = { id: "member", email: "member@example.com" }; return { data: { user }, error: null };
    },
    exchangeCodeForSession: async (...args) => {
      calls.push(["exchange", ...args]);
      if (authError) return { data: { user: null }, error: new Error("expired code") };
      user = { id: "member", email: "member@example.com" }; return { data: { user }, error: null };
    },
    getUser: async () => { calls.push(["getUser"]); return { data: { user }, error: null }; },
  };
  const request = async (url, options) => {
    calls.push(["verify", user?.id, url, options]);
    if (denied || user?.id !== "member") return Response.json({ error: "Invitation does not match this account" }, { status: 409 });
    return Response.json({ userId: returnedId ?? user.id, email: user.email });
  };
  return { calls, scrubbed, run: href => verifyInvitationSession({ auth }, href, url => scrubbed.push(url), request) };
}
test("Implicit invitation replaces an existing President session and verifies the recipient before returning a password target", async () => {
  const f = fixture(); const result = await f.run(link + "#access_token=member-access&refresh_token=member-refresh&type=invite");
  assert.deepEqual(result, { token, userId: "member", email: "member@example.com" });
  assert.deepEqual(f.calls.map(c => c[0]), ["setSession", "getUser", "verify"]);
  assert.equal(f.calls[2][1], "member"); assert.equal(f.scrubbed[0], `/join?invitation=${token}`);
  assert.deepEqual(JSON.parse(f.calls[2][3].body), { token });
});
test("Existing President login plus an invitation URL cannot become a password target", async () => {
  const f = fixture(); await assert.rejects(f.run(link), /does not match/);
  assert.equal(f.calls.some(c => c[0] === "setSession"), false);
});
test("Failed, expired and partial email credentials never fall back to the old President login", async () => {
  for (const suffix of ["#error=access_denied&error_description=expired", "#access_token=partial", "#refresh_token=partial", "#access_token=a&refresh_token=b"]) {
    const f = fixture({ authError: true }); await assert.rejects(f.run(link + suffix), /incomplete or expired/);
    assert.equal(f.calls.some(c => c[0] === "verify" || c[0] === "getUser"), false);
    assert.equal(f.scrubbed[0], `/join?invitation=${token}`);
  }
});
test("PKCE callback exchanges its code once, forwards a flow ID and removes authentication parameters", async () => {
  const f = fixture(); const result = await f.run(link + "&code=auth-code&sb_flow_id=flow");
  assert.equal(result.userId, "member"); assert.deepEqual(f.calls[0], ["exchange", "auth-code", { flowId: "flow" }]);
  assert.equal(f.scrubbed[0], `/join?invitation=${token}`);
  const expired = fixture({ authError: true }); await assert.rejects(expired.run(link + "&code=used"), /incomplete or expired/);
  assert.equal(expired.calls.length, 1);
});
test("Wrong, revoked or missing recipient sessions cannot pass verification", async () => {
  const denied = fixture({ denied: true }); await assert.rejects(denied.run(link + "#access_token=a&refresh_token=b"), /does not match/);
  const missing = fixture({ signedOut: true }); await assert.rejects(missing.run(link), /incomplete or expired/);
  assert.equal(missing.calls.some(c => c[0] === "verify"), false);
  const mismatch = fixture({ returnedId: "someone-else" }); await assert.rejects(mismatch.run(link + "#access_token=a&refresh_token=b"), /incomplete or expired/);
});
test("Browser client leaves normal recovery detection on but delegates Join URLs to invitation verification", async () => {
  const oldWindow = globalThis.window;
  const previous = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"; process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
  try {
    const fetchModule = await load("src/lib/browser-fetch.ts");
    const { createClient } = await load("src/lib/supabase/client.ts", {
      "@supabase/ssr": { createBrowserClient: (_url, _key, options) => options },
      "../browser-fetch": fetchModule,
    });
    assert.equal(createClient().global.fetch, fetchModule.browserFetch);
    globalThis.window = { location: { pathname: "/join" } }; assert.equal(createClient().auth.detectSessionInUrl, false);
    globalThis.window.location.pathname = "/update-password"; assert.equal(createClient().auth.detectSessionInUrl, true);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    for (const [i, key] of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].entries()) {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    }
  }
});
