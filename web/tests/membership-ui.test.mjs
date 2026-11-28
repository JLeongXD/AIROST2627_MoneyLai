import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Module, createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import React from "react";
const require = createRequire(import.meta.url);
async function load(file, imports) {
  const mod = new Module(path.resolve(file)); mod.filename = path.resolve(file);
  mod.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  mod._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, mod.filename);
  return mod.exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
}
test("Membership page offers password setup only after approval, with explicit application and closed-account screens", async () => {
  for (const scenario of ["signed-out", "new", "pending", "approved", "rejected", "disabled", "active"]) {
    const routes = [], calls = [], effects = [];
    function Stub() { return null; }
    const profile = { account_status: ["disabled", "active"].includes(scenario) ? scenario : "invited" };
    const context = { ready: true, user: scenario === "signed-out" ? null : { id: "applicant", email: "applicant@gmail.com", identities: [{ provider: "google" }] }, profile, refreshProfile() {} };
    const mod = await load("src/features/auth/MembershipPage.tsx", {
      react: { ...React, useEffect: fn => effects.push(fn), useState: value => [value, () => {}] },
      "next/link": { default: Stub }, "next/navigation": { useRouter: () => ({ replace: route => routes.push(route) }) },
      "@/components/AuthProvider": { useAuth: () => context }, "@/components/UI": { Field: Stub, Notice: Stub },
      "@/lib/supabase/client": { createClient: () => ({}) }, "@/lib/api": { rpc: async name => { calls.push(name); } },
      "@/lib/useLoad": { useLoad: () => ({ data: ["pending", "approved", "rejected"].includes(scenario) ? { status: scenario, reason: "Review reason" } : null, loading: false, reload() {} }) },
      "@/lib/domain": { errorMessage: e => e.message }, "@/lib/members/google": { continueWithGoogle: async () => {} },
    });
    const tree = mod.default(); effects.forEach(fn => fn());
    const elements = nodes(tree);
    assert.equal(elements.some(n => n.type === "input" && n.props.type === "password"), scenario === "approved", scenario);
    const apply = elements.find(n => n.type === "button" && n.props.children === "Submit membership application");
    assert.equal(Boolean(apply), scenario === "new", scenario);
    if (apply) { await apply.props.onClick(); assert.deepEqual(calls, ["ml_request_membership"]); }
    if (scenario === "active") assert.deepEqual(routes, ["/dashboard"]);
    if (scenario === "rejected") assert.match(JSON.stringify(tree), /Review reason/);
  }
});
test("Google sign-in uses the membership callback and account chooser; callback destinations are allowlisted", async () => {
  let options;
  const google = await load("src/lib/members/google.ts", { "@/lib/supabase/client": { createClient: () => ({ auth: { signInWithOAuth: async value => { options = value; return {}; } } }) } });
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://moneylai.example" } };
  try { await google.continueWithGoogle(); } finally { globalThis.window = originalWindow; }
  assert.equal(options.provider, "google");
  assert.equal(options.options.redirectTo, "https://moneylai.example/auth/callback?next=/membership");
  assert.equal(options.options.queryParams.prompt, "select_account");
  for (const next of ["/membership", "/update-password", "https://evil.example", "//evil.example"]) {
    const callback = await load("src/app/auth/callback/route.ts", { "@/lib/supabase/server": { createServerSupabaseClient: async () => ({ auth: { exchangeCodeForSession: async () => ({}) } }) } });
    const result = await callback.GET(new Request(`https://moneylai.example/auth/callback?code=test&next=${encodeURIComponent(next)}`));
    assert.equal(result.headers.get("location"), `https://moneylai.example${["/membership", "/update-password"].includes(next) ? next : "/dashboard"}`);
  }
});
