import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function load(file, imports) {
  const m = new Module(path.resolve(file)); m.filename = path.resolve(file); m.paths = require.resolve.paths("typescript");
  m.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, m.filename);
  return m.exports;
}
const who = "11111111-1111-4111-8111-111111111111", token = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
async function fixture({ authenticated = true, role = "president", status = "active", existing = false, confirmed = true, sendError = false,
  prepareError = false, invalidInvite = false, activateError = false, passwordError = false, deliveryError = false } = {}) {
  const calls = [];
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role, account_status: status } }) }) }) }),
    rpc: async (name, args) => {
      calls.push([name, args]);
      return prepareError ? { error: { message: "Invitation already exists" } } : { data: { id, token, email: "new@example.com", display_name: "New Member", existing_user: existing ? who : null } };
    },
  };
  const admin = {
    auth: {
      resetPasswordForEmail: async (...args) => { calls.push(["recovery", ...args]); return { error: sendError ? { message: "Provider secret error", code: typeof sendError === "string" ? sendError : undefined } : null }; },
      admin: {
        getUserById: async user => { calls.push(["lookup", user]); return { data: { user: { email_confirmed_at: confirmed ? "2026-11-26T00:00:00Z" : null } } }; },
        inviteUserByEmail: async (...args) => { calls.push(["invite", ...args]); return { error: sendError ? { message: "Provider secret error", code: typeof sendError === "string" ? sendError : undefined } : null }; },
        updateUserById: async (...args) => { calls.push(["password", ...args]); return { error: passwordError ? { message: "Weak password" } : null }; },
      },
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "ml_validate_invitation" && invalidInvite) return { error: { message: "Invitation expired or revoked" } };
      if (name === "ml_activate_member" && activateError) return { error: { message: "Invitation revoked during password update" } };
      if (name === "ml_invitation_delivery" && deliveryError) return { error: { message: "Invitation changed" } };
      return { data: id };
    },
  };
  const imports = { "@/lib/members/server": {
    memberJson: (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } }),
    memberId: value => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value),
    sameOrigin: request => request.headers.get("origin") === new URL(request.url).origin,
    memberSession: async () => ({ client, user: authenticated ? { id: who, email: "new@example.com" } : null }),
    memberAdmin: () => { calls.push(["admin"]); return admin; },
  } };
  const invite = (await load("src/app/api/members/invitations/route.ts", imports)).POST;
  const activate = (await load("src/app/api/members/activate/route.ts", imports)).POST;
  const verify = (await load("src/app/api/members/invitations/verify/route.ts", imports)).POST;
  return { calls, run: (kind = "invitations", body = { name: "New Member", email: "new@example.com" }, origin = "https://moneylai.example") =>
    (kind === "activate" ? activate : kind === "verify" ? verify : invite)(new Request(`https://moneylai.example/api/members/${kind}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) })) };
}

test("Invitation verification binds the authenticated account to the invitation without changing any password", async () => {
  const f = await fixture(); const response = await f.run("verify", { token, userId: id, role: "president" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { userId: who, email: "new@example.com" });
  assert.deepEqual(f.calls.find(c => c[0] === "ml_validate_invitation")[1], { p_user: who, p_token: token });
  assert.equal(f.calls.some(c => c[0] === "password" || c[0] === "ml_activate_member"), false);
  const wrong = await fixture({ invalidInvite: true });
  assert.equal((await wrong.run("verify", { token })).status, 409);
  assert.equal(wrong.calls.some(c => c[0] === "password"), false);
  const missing = await fixture({ authenticated: false }); assert.equal((await missing.run("verify", { token })).status, 401);
  const bad = await fixture(); assert.equal((await bad.run("verify", { token: "invalid" })).status, 400); assert.equal(bad.calls.length, 0);
  const cross = await fixture(); assert.equal((await cross.run("verify", { token }, "https://evil.example")).status, 403); assert.equal(cross.calls.length, 0);
});
test("Invitation endpoint rejects foreign origins, unsigned users, Treasurers and disabled Presidents before privilege use", async () => {
  const cross = await fixture(); assert.equal((await cross.run("invitations", {}, "https://evil.example")).status, 403); assert.equal(cross.calls.length, 0);
  for (const options of [{ authenticated: false }, { role: "member" }, { role: "treasurer" }, { status: "disabled" }, { status: "invited" }]) {
    const f = await fixture(options); const response = await f.run();
    assert.equal(response.status, options.authenticated === false ? 401 : 403); assert.equal(f.calls.length, 0);
  }
});
test("New invitation uses email delivery and does not return a password or invitation secret", async () => {
  const f = await fixture(); const response = await f.run();
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const mail = f.calls.find(c => c[0] === "invite");
  assert.equal(mail[1], "new@example.com"); assert.equal(mail[2].redirectTo, `https://moneylai.example/join?invitation=${token}`);
  assert.equal(mail[2].data.role, undefined);
  assert.equal((await response.text()).includes(token), false);
  assert.equal(f.calls.find(c => c[0] === "ml_invitation_delivery")[1].p_success, true);
});
test("Resend to an existing invited user uses a fresh recovery link without recreating/deleting accounts", async () => {
  const f = await fixture({ existing: true }); assert.equal((await f.run("invitations", { invitationId: id })).status, 200);
  assert.equal(f.calls.some(c => c[0] === "invite"), false);
  assert.equal(f.calls.find(c => c[0] === "recovery")[2].redirectTo, `https://moneylai.example/join?invitation=${token}`);
  assert.deepEqual(f.calls.find(c => c[0] === "ml_prepare_invitation")[1], { p_email: "", p_name: "", p_invitation: id });
});
test("An unconfirmed recipient receives another invitation email on resend", async () => {
  const f = await fixture({ existing: true, confirmed: false });
  assert.equal((await f.run("invitations", { invitationId: id })).status, 200);
  assert.equal(f.calls.some(c => c[0] === "recovery"), false);
  assert.equal(f.calls.some(c => c[0] === "invite"), true);
});
test("Duplicate, mail failure and stale delivery responses remain retryable and do not leak provider errors", async () => {
  const duplicate = await fixture({ prepareError: true }); assert.equal((await duplicate.run()).status, 409); assert.equal(duplicate.calls.some(c => c[0] === "invite"), false);
  const failed = await fixture({ sendError: true }); const response = await failed.run();
  assert.equal(response.status, 502); const text = await response.text(); assert.match(text, /Resend/); assert.equal(text.includes("Provider secret"), false);
  assert.equal(failed.calls.find(c => c[0] === "ml_invitation_delivery")[1].p_success, false);
  const stale = await fixture({ deliveryError: true }); assert.equal((await stale.run()).status, 409);
});
test("Invitation failures explain known email restrictions without exposing provider messages", async () => {
  for (const [code, expected] of [
    ["email_address_not_authorized", /Configure Custom SMTP/],
    ["over_email_send_rate_limit", /quota to reset/],
    ["over_request_rate_limit", /Wait before using Resend/],
    ["unknown_provider_code", /Check Supabase Auth logs/],
  ]) {
    for (const existing of [false, true]) {
      const f = await fixture({ sendError: code, existing });
      const response = await f.run();
      assert.equal(response.status, 502);
      const text = await response.text(); assert.match(text, expected);
      assert.equal(text.includes("Provider secret error"), false);
      assert.equal(text.includes(token), false);
      assert.equal(f.calls.find(c => c[0] === "ml_invitation_delivery")[1].p_success, false);
    }
  }
});
test("Activation uses the verified user's ID, validates before changing password, and never accepts a supplied role", async () => {
  const f = await fixture(); const response = await f.run("activate", { token, password: "test-password-789", userId: id, role: "president" });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.find(c => c[0] === "ml_validate_invitation")[1], { p_user: who, p_token: token });
  assert.deepEqual(f.calls.find(c => c[0] === "password").slice(1), [who, { password: "test-password-789" }]);
  assert.deepEqual(f.calls.find(c => c[0] === "ml_activate_member")[1], { p_user: who, p_token: token });
  assert.equal((await response.text()).includes("test-password"), false);
  const invalid = await fixture({ invalidInvite: true }); assert.equal((await invalid.run("activate", { token, password: "test-password-789" })).status, 409);
  assert.equal(invalid.calls.some(c => c[0] === "password"), false);
});
test("Activation handles auth expiry, invalid input, password rejection and a concurrent invitation revocation", async () => {
  const loggedOut = await fixture({ authenticated: false }); assert.equal((await loggedOut.run("activate", { token, password: "test-password-789" })).status, 401);
  const short = await fixture(); assert.equal((await short.run("activate", { token, password: "short" })).status, 400); assert.equal(short.calls.length, 0);
  const weak = await fixture({ passwordError: true }); assert.equal((await weak.run("activate", { token, password: "test-password-789" })).status, 400);
  assert.equal(weak.calls.some(c => c[0] === "ml_activate_member"), false);
  const revoked = await fixture({ activateError: true }); assert.equal((await revoked.run("activate", { token, password: "test-password-789" })).status, 409);
});
