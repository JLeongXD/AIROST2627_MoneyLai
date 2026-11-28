import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import React from "react";
const require = createRequire(import.meta.url);
const user = { id: "a", email: "member-a@example.com" };
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
}
function textContent(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return Array.isArray(tree) ? tree.map(textContent).join("") : textContent(tree.props?.children);
}
async function harness(initial = { user, ready: true, error: "" }) {
  const slots = []; let cursor = 0, tree;
  const context = { ...initial }, routes = [], calls = [], effects = [];
  let signOutError = null, keepSession = false, sessionError = null, gate = null;
  const hooks = { ...React, useEffect: fn => effects.push(fn),
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  };
  const auth = {
    signOut: async options => { calls.push(["signOut", options]); if (gate) await gate; if (!signOutError && !keepSession) context.user = null; return { error: signOutError }; },
    getSession: async () => ({ data: { session: context.user ? { user: context.user } : null }, error: sessionError }),
    signInWithPassword: async fields => { calls.push(["signIn", fields]); return { error: null }; },
    resetPasswordForEmail: async (...args) => { calls.push(["reset", ...args]); return { error: null }; },
  };
  function Stub() { return null; }
  const imports = { react: hooks, "next/link": { default: Stub }, "next/navigation": { useRouter: () => ({ replace: route => routes.push(route) }) },
    "@/lib/members/google": { continueWithGoogle: async () => { calls.push(["google"]); } },
    "@/lib/supabase/client": { createClient: () => ({ auth }) }, "@/components/AuthProvider": { useAuth: () => context },
    "@/lib/domain": { errorMessage: e => e.message }, "@/components/UI": { Field: Stub, Notice: Stub },
    "./LoginPage.module.css": { default: new Proxy({}, { get: (_, key) => key }) },
  };
  const mod = new Module(path.resolve("src/features/auth/LoginPage.tsx")); mod.filename = path.resolve("src/features/auth/LoginPage.tsx");
  mod.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  mod._compile(ts.transpileModule(await readFile(mod.filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, mod.filename);
  const render = () => { cursor = 0; tree = mod.exports.default(); for (const fn of effects.splice(0)) fn(); };
  render();
  return { context, calls, routes, render,
    button: label => nodes(tree).find(n => n.type === "button" && textContent(n) === label),
    input: id => nodes(tree).find(n => n.type === "input" && n.props.id === id),
    change: (id, value) => nodes(tree).find(n => n.type === "input" && n.props.id === id).props.onChange({ target: { value } }),
    submit: async () => { await nodes(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); render(); },
    click: async label => { const button = nodes(tree).find(n => n.type === "button" && textContent(n) === label); button.props.onClick(); render(); await new Promise(resolve => setImmediate(resolve)); render(); },
    text: () => JSON.stringify(tree, (_key, value) => typeof value === "function" ? undefined : value),
    configure: options => { signOutError = options.signOutError ?? null; keepSession = options.keepSession ?? false; sessionError = options.sessionError ?? null; gate = options.gate ?? null; },
  };
}

test("Existing session stays on Login until Continue is clicked; loading never flashes a sign-in form", async () => {
  const h = await harness();
  assert.equal(h.routes.length, 0); assert.match(h.text(), /member-a@example.com/);
  assert.ok(h.button("Continue with this account")); assert.ok(h.button("Sign in with another account")); assert.equal(h.input("email"), undefined);
  await h.click("Continue with this account"); assert.deepEqual(h.routes, ["/dashboard"]); assert.equal(h.calls.length, 0);
  const loading = await harness({ user: null, ready: false, error: "" });
  assert.equal(loading.input("email"), undefined); assert.match(loading.text(), /Checking your sign-in status/);
});

test("Signed-out users can choose Google instead of entering a password", async () => {
  const h = await harness({ user: null, ready: true, error: "" });
  assert.ok(h.button("Continue with Google"));
  assert.ok(h.input("email")); assert.ok(h.input("password"));
  await h.click("Continue with Google");
  assert.deepEqual(h.calls, [["google"]]);
  assert.match(h.text(), /President approval required/);
});

test("Account switch uses local sign-out, waits for completion and exposes empty fields for account B", async () => {
  const h = await harness(); let release;
  h.configure({ gate: new Promise(resolve => { release = resolve; }) });
  const switchButton = h.button("Sign in with another account");
  await h.click("Sign in with another account");
  switchButton.props.onClick();
  assert.equal(h.calls.length, 1); // Rapid clicks cannot start duplicate sign-outs.
  h.context.user = null; h.render(); // The auth event can arrive before the request finishes.
  assert.equal(h.input("email"), undefined); assert.match(h.text(), /Signing out/);
  release(); await new Promise(resolve => setImmediate(resolve)); h.render();
  assert.deepEqual(h.calls[0], ["signOut", { scope: "local" }]); assert.equal(h.routes.length, 0);
  assert.equal(h.input("email").props.value, ""); assert.equal(h.input("password").props.value, "");
  h.change("email", "member-b@example.com"); h.change("password", "test-password-b"); h.render(); await h.submit();
  assert.deepEqual(h.calls[1], ["signIn", { email: "member-b@example.com", password: "test-password-b" }]);
  assert.deepEqual(h.routes, ["/dashboard"]);
});

test("Failed sign-out or retained session stays visible with an error and can be retried", async () => {
  for (const options of [{ signOutError: new Error("Network unavailable") }, { keepSession: true }, { keepSession: true, sessionError: new Error("Session read failed") }]) {
    const h = await harness(); h.configure(options); await h.click("Sign in with another account");
    assert.equal(h.input("email"), undefined); assert.equal(h.routes.length, 0);
    assert.match(h.text(), /Network unavailable|not complete|Session read failed/);
    assert.ok(h.button("Sign in with another account"));
    h.configure({}); await h.click("Sign in with another account"); assert.equal(h.input("email").props.value, "");
  }
});

test("Signed-out login validation and password recovery remain available", async () => {
  const h = await harness({ user: null, ready: true, error: "" });
  await h.submit(); assert.match(h.text(), /valid email/); assert.equal(h.calls.length, 0);
  h.change("email", "member-b@example.com"); h.render(); await h.submit(); assert.match(h.text(), /Enter your password/);
  await h.click("Forgot password?"); assert.equal(h.input("password"), undefined);
  const previous = globalThis.window; globalThis.window = { location: { origin: "https://moneylai.test" } };
  try { await h.submit(); } finally { globalThis.window = previous; }
  assert.deepEqual(h.calls[0], ["reset", "member-b@example.com", { redirectTo: "https://moneylai.test/auth/callback?next=/update-password" }]);
  assert.match(h.text(), /recovery link will be sent/);
});
