import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reading, selection, subtotalReading, itemAnswers } from "./fixtures/receipt.mjs";
const require = createRequire(import.meta.url);
async function load(file, imports = {}) {
  const m = new Module(path.resolve(file)); m.filename = path.resolve(file); m.paths = require.resolve.paths("typescript");
  m.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, m.filename);
  return m.exports;
}
const domain = await load("src/lib/domain.ts"), allocation = await load("src/lib/ai/receipt-allocation.ts");
const budget = await load("src/lib/budget.ts", { "./ai/receipt-allocation": allocation });
const BudgetNotice = (await load("src/components/BudgetNotice.tsx", { "@/lib/domain": domain, "@/lib/budget": budget, "./BudgetNotice.module.css": { default: {} } })).default;
const { saveClaimDraft } = await load("src/lib/claim-draft.ts");
const { browserFetch } = await load("src/lib/browser-fetch.ts");
const fields = { activityId: "activity", amount: "80.00", description: "Workshop materials", purchaseDate: "2026-01-01", category: "Materials" };
const activity = { id: "activity", name: "Workshop", status: "active", budget: 1000, remaining_budget: 1000 };
const payout = { recipient_name: "Test Member", provider_name: "Test Bank", account_number: "12345678" };
const receipt = { id: "attachment", claim_id: "draft", kind: "receipt", original_name: "receipt.pdf", storage_path: "test/receipt.pdf" };
const claim = { id: "draft", claimant_id: "member", activity_id: "activity", amount: "80.00", description: fields.description, purchase_date: fields.purchaseDate, category: "Materials", status: "draft", info_requested_at: null };
function services(options = {}) {
  const calls = [], db = { claim: { ...claim }, files: [], plan: null };
  let uploadFailure = options.uploadFailure, readFailure = options.readFailure;
  return { calls, db,
    rpc: async (name, args) => { calls.push([name, args]); if (name === "ml_save_claim") { Object.assign(db.claim, { amount: args.p_amount, description: args.p_description }); return "draft"; } },
    upload: async () => { calls.push(["upload"]); if (uploadFailure) { uploadFailure = false; throw new Error("Upload offline"); } db.files = [receipt]; },
    claim: async () => { if (readFailure) { readFailure = false; throw new Error("Read offline"); } return db.claim; },
    attachments: async () => db.files,
    plan: async () => db.plan,
    fetch: async (_url, init) => { const data = JSON.parse(init.body); calls.push(["assisted", data]); if (options.assistedFailure && !data.claimId) return Response.json({ claimId: "draft", error: "Original copy interrupted" }, { status: 409 }); db.files = [receipt]; db.plan = { revision: data.revision + 1 }; return Response.json({ claimId: "draft" }); },
  };
}
test("Manual draft retries reuse its ID; successful uploads are not repeated after a read failure", async () => {
  const s = services({ uploadFailure: true }), p = { id: null, uploadedFile: null, revision: 0 }, file = { name: "receipt.pdf" };
  await assert.rejects(saveClaimDraft(fields, file, null, p, s), /Upload offline/);
  assert.equal(p.id, "draft"); assert.equal(p.uploadedFile, null);
  await saveClaimDraft(fields, file, null, p, s);
  await saveClaimDraft({ ...fields, amount: "70.00" }, file, null, p, s);
  assert.deepEqual(s.calls.filter(c => c[0] === "ml_save_claim").map(c => c[1].p_claim_id), [null, "draft", "draft"]);
  assert.equal(s.calls.filter(c => c[0] === "upload").length, 2);
  const s2 = services({ readFailure: true }), p2 = { id: null, uploadedFile: null, revision: 0 };
  await assert.rejects(saveClaimDraft(fields, file, null, p2, s2), /Read offline/);
  await saveClaimDraft(fields, file, null, p2, s2);
  assert.equal(s2.calls.filter(c => c[0] === "upload").length, 1);
});
test("Assisted partial saves preserve recovery IDs, advance revisions and keep the original when switching to manual", async () => {
  const s = services({ assistedFailure: true }), p = { id: null, uploadedFile: null, revision: 0 }, file = { name: "receipt.png" };
  const assisted = { sessionId: "session", extraction: reading, selection };
  await assert.rejects(saveClaimDraft(fields, file, assisted, p, s), /Original copy interrupted/);
  assert.equal(p.id, "draft"); assert.equal(p.revision, 0);
  await saveClaimDraft(fields, file, assisted, p, s);
  await saveClaimDraft(fields, file, assisted, p, s);
  assert.deepEqual(s.calls.filter(c => c[0] === "assisted").map(c => [c[1].claimId, c[1].revision]), [[null, 0], ["draft", 0], ["draft", 1]]);
  await saveClaimDraft(fields, file, null, p, s);
  assert.equal(s.calls.some(c => c[0] === "upload"), false);
});
function nodes(root) {
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
async function harness(props = {}, api = services(), useProductionFetch = false) {
  const slots = []; let cursor = 0;
  function slot(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return i; }
  const hooks = { ...React, useEffect: () => {}, useRef: value => slots[slot({ current: value })], useState: value => {
    const i = slot(value); return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  const routes = [], notifications = [];
  function Assistant() { return null; }
  function Stub() { return null; }
  const { ClaimForm } = await load("src/features/claims/ClaimEditorPage.tsx", {
    react: hooks, "next/link": Stub, "next/navigation": { useRouter: () => ({ replace: url => routes.push(url), push: url => routes.push(url) }) },
    "@/components/UI": { PageHeader: Stub, Loading: Stub, Notice: Stub, Field: Stub, FileLink: Stub },
    "@/components/AuthProvider": {}, "@/lib/useLoad": {}, "@/lib/supabase/client": {},
    "@/components/ReceiptAssistant": { default: Assistant }, "@/components/AIClaimCheck": Stub, "@/components/ReceiptAllocation": Stub,
    "@/components/BudgetNotice": { default: BudgetNotice },
    "@/lib/api": { rpc: api.rpc, uploadAttachment: api.upload, getClaim: api.claim, getAttachments: api.attachments, getReceiptPlan: api.plan },
    "@/lib/claim-draft": { saveClaimDraft: (...args) => saveClaimDraft(...args.slice(0, 4), useProductionFetch ? { ...api, fetch: args[4].fetch } : api) },
    "@/lib/browser-fetch": { browserFetch },
    "@/lib/ai/receipt-allocation": allocation, "@/lib/domain": domain,
    "@/components/FeedbackProvider": { useFeedback: () => value => notifications.push(value) }, "./ClaimEditorPage.module.css": new Proxy({}, { get: (_, key) => key }),
  });
  let tree;
  const render = () => { cursor = 0; tree = ClaimForm({ claim: null, activities: [activity], initialActivity: "activity", payout, ...props }); return tree; };
  render();
  return { api, routes, notifications, render, assistant: () => nodes(tree).find(n => n.type === Assistant).props,
    change: (id, value) => nodes(tree).find(n => typeof n.type === "string" && n.props?.id === id).props.onChange({ target: { value } }),
    advance: async () => { await nodes(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); render(); },
    back: () => { nodes(tree).find(n => n.type === "button" && n.props?.children === "Back").props.onClick(); render(); },
    saveExit: async () => { nodes(tree).find(n => n.type === "button" && n.props?.children === "Save & exit").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render(); },
    input: id => nodes(tree).find(n => typeof n.type === "string" && n.props?.id === id)?.props,
    primary: () => nodes(tree).find(n => n.type === "button" && n.props?.className === "button primary")?.props,
    click: label => { nodes(tree).find(n => n.type === "button" && n.props?.children === label).props.onClick(); render(); },
    budgetHtml: () => { const notice = nodes(tree).find(n => n.type === BudgetNotice); return notice ? renderToStaticMarkup(notice) : ""; },
    text: () => JSON.stringify(tree, (key, value) => typeof value === "function" ? undefined : value),
  };
}
async function withDom(run) {
  const original = { document: globalThis.document, raf: globalThis.requestAnimationFrame };
  globalThis.document = { getElementById: () => null };
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  try { await run(); } finally { globalThis.document = original.document; globalThis.requestAnimationFrame = original.raf; }
}

test("Budget warnings show exact shortfalls and ignore incomplete amounts without assuming an unknown budget is zero", () => {
  for (const [amount, available, expected] of [["15.00", "10.00", "5.00"], ["0.30", "0.29", "0.01"],
    ["15.00", "15.00", null], ["9.99", "10.00", null], ["15.00", "0.00", "15.00"],
    ["15.00", "-5.00", "20.00"], ["", "10.00", null], ["NaN", "10.00", null],
    ["-1.00", "10.00", null], ["0.00", "10.00", null], ["15.00", undefined, null], ["15.001", "10.00", null]])
    assert.equal(budget.budgetShortfall(amount, available), expected);
  const html = renderToStaticMarkup(React.createElement(BudgetNotice, { amount: "15.00", available: "10.00" }));
  assert.match(html, /Activity budget insufficient/); assert.match(html, /role="status"/);
  assert.match(html, /Available activity budget<\/dt><dd>RM\s*10\.00/);
  assert.match(html, /This claim<\/dt><dd>RM\s*15\.00/);
  assert.match(html, /Over budget by<\/dt><dd>RM\s*5\.00/);
  assert.match(html, /You can still submit/); assert.match(html, /before approval/);
});

test("RM15 against RM10 warns during entry and review while allowing the unchanged amount to be submitted", () => withDom(async () => {
  const activities = [{ ...activity, remaining_budget: "10.00" }];
  const h = await harness({ activities }); await h.advance();
  assert.equal(h.assistant().availableBudget, "10.00");
  h.assistant().onFileChange({ name: "receipt.pdf" }); h.render(); await h.advance();
  h.change("amount", "15.00"); h.change("description", "Workshop supplies"); h.render();
  assert.match(h.budgetHtml(), /RM\s*5\.00/); assert.equal(h.primary().disabled, false);
  h.change("amount", "10.00"); h.render(); assert.equal(h.budgetHtml(), "");
  h.change("amount", "15.00"); h.render();
  activities[0].remaining_budget = "20.00"; h.render(); assert.equal(h.budgetHtml(), "");
  activities[0].remaining_budget = "10.00"; h.render(); assert.match(h.budgetHtml(), /RM\s*5\.00/);
  await h.advance();
  assert.equal(h.api.calls.find(c => c[0] === "ml_save_claim")[1].p_amount, "15.00");
  const review = await harness({ claim: h.api.db.claim, initialAttachments: h.api.db.files, initialStep: 4, activities }, h.api);
  assert.match(review.budgetHtml(), /You can still submit/); assert.match(review.budgetHtml(), /RM\s*5\.00/);
  assert.equal(review.primary().disabled, false);
  await review.advance();
  assert.equal(h.api.calls.filter(c => c[0] === "ml_submit_claim").length, 1);
  assert.equal(h.api.db.claim.amount, "15.00");
}));
test("AI draft save keeps the native Window.fetch receiver for Next and Save & exit", () => withDom(async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  try {
    for (const action of ["advance", "saveExit"]) {
      const api = services(); let requests = 0;
      const browserWindow = { fetch: async function(input, init) {
        assert.equal(this, browserWindow, "Native WebKit fetch requires Window as its receiver");
        requests++;
        assert.equal(input, "/api/receipt-drafts/session/save");
        assert.equal(init.method, "POST");
        assert.equal(JSON.parse(init.body).fields.amount, "100.00");
        return api.fetch(input, init);
      } };
      globalThis.window = browserWindow; globalThis.fetch = browserWindow.fetch;
      const h = await harness({}, api, true);
      await h.advance(); h.assistant().onFileChange({ name: "receipt.png" });
      h.assistant().onChange({ sessionId: "session", extraction: reading,
        selection: { ...allocation.initialSelection(reading), items: itemAnswers(reading.items), confirmed: true } });
      h.render(); await h.advance(); assert.equal(h.input("amount").value, "100.00");
      await h[action]();
      assert.equal(requests, 1);
      assert.equal(h.routes.at(-1), action === "advance" ? "/claims/draft/edit?step=review" : "/claims/draft");
      assert.equal(api.calls.some(c => c[0] === "ml_submit_claim"), false);
    }
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
}));

test("New manual claims use four steps, retain corrections on Back and only submit from the saved review", () => withDom(async () => {
  const h = await harness(); await h.advance();
  assert.equal(h.primary().children, "Next: expense details →");
  await h.advance(); assert.match(h.text(), /Add a receipt/); assert.equal(h.api.calls.length, 0);
  h.assistant().onFileChange({ name: "receipt.pdf" }); h.render(); await h.advance();
  h.change("amount", "42.50"); h.change("description", "Club supplies"); h.render();
  h.back(); await h.advance(); assert.equal(h.input("amount").value, "42.50");
  await h.advance(); assert.equal(h.routes.at(-1), "/claims/draft/edit?step=review");
  assert.equal(h.api.calls.some(c => c[0] === "ml_submit_claim"), false);
  const review = await harness({ claim: h.api.db.claim, initialAttachments: h.api.db.files, initialStep: 4 }, h.api);
  assert.equal(review.primary().children, "Submit claim"); await review.advance();
  assert.equal(h.api.calls.filter(c => c[0] === "ml_submit_claim").length, 1);
  assert.equal(review.routes.at(-1), "/claims/draft?submitted=1");
}));
test("AI confirmation is required before applying; manually corrected fields survive returning through Receipt", () => withDom(async () => {
  const h = await harness(); await h.advance(); h.assistant().onFileChange({ name: "receipt.png" });
  h.assistant().onChange({ sessionId: "session", extraction: reading, selection: { ...selection, confirmed: false } }); h.render();
  await h.advance(); assert.match(h.text(), /confirm|manual entry/); assert.equal(h.primary().children, "Next: expense details →");
  h.assistant().onChange({ sessionId: "session", extraction: reading, selection }); h.render(); await h.advance();
  assert.equal(h.input("amount").value, "80.00"); h.change("amount", "75.00"); h.render();
  h.back(); await h.advance(); assert.equal(h.input("amount").value, "75.00");
}));
test("Whole and automatic partial claims apply the confirmed total and keep it tied to the receipt calculation", () => withDom(async () => {
  for (const mode of ["full", "auto", "simple"]) {
    const h = await harness(); await h.advance(); h.assistant().onFileChange({ name: "receipt.png" });
    const chosen = { ...allocation.initialSelection(reading, mode), confirmed: true, items: reading.items.map(i => ({ id: i.id, included: true, amount: i.amount, reason: "Workshop supplies" })) };
    h.assistant().onChange({ sessionId: "session", extraction: reading, selection: chosen }); h.render(); await h.advance();
    assert.equal(h.input("amount").value, "100.00"); assert.equal(h.input("amount").readOnly, true);
    h.back(); await h.advance(); assert.equal(h.input("amount").value, "100.00");
    await h.advance(); assert.equal(h.api.calls.find(c => c[0] === "assisted")[1].selection.mode, mode);
    assert.equal(h.routes.at(-1), "/claims/draft/edit?step=review");
  }
}));

test("Next requires every item answer and generates purpose from the current selected purchases", () => withDom(async () => {
  const h = await harness(); await h.advance(); h.assistant().onFileChange({ name: "receipt.png" });
  const raw = { ...subtotalReading, merchant: "MR D.I.Y.", suggested_description: "Oil absorb towels and tarpaulin canvas",
    items: [{ ...subtotalReading.items[0], description: "Oil absorb towels" }, subtotalReading.items[1]] };
  let chosen = { ...allocation.initialSelection(raw, "simple"), confirmed: true };
  chosen.items[1].included = false;
  const update = async () => { h.assistant().onChange({ sessionId: "session", extraction: raw, selection: chosen }); h.render(); await h.advance(); };
  await update(); assert.match(h.text(), /Enter the activity purpose/);
  assert.equal(h.primary().children, "Next: expense details →");
  chosen.items[0].reason = "Clean the robotics workshop area";
  await update(); assert.match(h.text(), /Explain why.*excluded/);
  chosen.items[1].reason = "Personal camping purchase";
  await update();
  assert.match(h.input("description").value, /Oil absorb towels.*Clean the robotics workshop area/);
  assert.doesNotMatch(h.input("description").value, /Tarpaulin|tarpaulin|camping/);
  assert.equal(h.input("amount").value, "84.30");
  h.back(); chosen = { ...chosen, items: chosen.items.map((i, index) => index === 0 ? { ...i, reason: "Clean the club equipment after the workshop" } : i) };
  await update(); assert.match(h.input("description").value, /Clean the club equipment/);
  h.change("description", "My own explanation of the cleaning supplies"); h.render(); h.back();
  chosen = { ...chosen, items: chosen.items.map((i, index) => index === 0 ? { ...i, reason: "Cleaning tables during the workshop" } : i) };
  await update();
  assert.equal(h.input("description").value, "My own explanation of the cleaning supplies");
  assert.match(h.text(), /Your edited description was kept/);
  h.click("Regenerate purpose from item answers");
  assert.match(h.input("description").value, /Cleaning tables during the workshop/);
  assert.doesNotMatch(h.input("description").value, /Tarpaulin|tarpaulin|camping/);
  assert.doesNotMatch(h.text(), /Your edited description was kept/);
  await h.advance();
  const saved = h.api.calls.find(c => c[0] === "assisted")[1];
  assert.match(saved.fields.description, /Cleaning tables during the workshop/);
  assert.equal(saved.selection.items[1].reason, "Personal camping purchase");
}));

test("Review blocks missing payout, and clarification drafts send a required reply instead of normal submission", () => withDom(async () => {
  const missing = await harness({ claim, initialAttachments: [receipt], initialStep: 4, payout: null });
  assert.equal(missing.primary().disabled, true); await missing.advance(); assert.equal(missing.api.calls.length, 0);
  const h = await harness({ claim: { ...claim, info_requested_at: "2026-01-02" }, initialAttachments: [receipt], initialStep: 4, question: "Why was this needed?" });
  await h.advance(); assert.equal(h.api.calls.length, 0); assert.match(h.text(), /Reply to the Treasurer/);
  h.change("claim-reply", "Added the purpose and clearer receipt."); h.render(); await h.advance();
  assert.equal(h.api.calls[0][0], "ml_reply_information"); assert.equal(h.primary().children, "Reply & resubmit");
}));

test("Deselected purchases advance with RM84.30 automatically or after explicit subtotal confirmation", () => withDom(async () => {
  for (const total of ["112.20", "113.20"]) {
    const h = await harness(); await h.advance(); h.assistant().onFileChange({ name: "receipt.png" });
    const receipt = { ...subtotalReading, total };
    let chosen = { ...allocation.initialSelection(receipt, "simple"), items: itemAnswers(receipt.items), confirmed: true };
    chosen.items[1].included = false; chosen.items[1].reason = "Personal";
    if (total === "113.20") {
      h.assistant().onChange({ sessionId: "session", extraction: receipt, selection: chosen }); h.render(); await h.advance();
      assert.equal(h.primary().children, "Next: expense details →");
      chosen = allocation.confirmSelectedItemAmount(chosen);
    }
    h.assistant().onChange({ sessionId: "session", extraction: receipt, selection: chosen }); h.render(); await h.advance();
    assert.equal(h.input("amount").value, "84.30"); assert.equal(h.input("amount").readOnly, true);
    await h.advance(); assert.equal(h.routes.at(-1), "/claims/draft/edit?step=review");
    const saved = h.api.calls.find(c => c[0] === "assisted")[1];
    assert.equal(saved.fields.amount, "84.30"); assert.equal(saved.selection.items[1].included, false);
    if (total === "113.20") assert.match(saved.selection.override_reason, /84.30.*27.90/);
  }
}));

test("An explained reimbursement above the AI receipt total proceeds to details and saves for review", () => withDom(async () => {
  const h = await harness(); await h.advance(); h.assistant().onFileChange({ name: "receipt.png" });
  let chosen = { ...allocation.initialSelection(subtotalReading, "simple"), items: itemAnswers(subtotalReading.items), confirmed: true,
    claimed_amount: "116.20", override_reason: "" };
  const update = async () => { h.assistant().onChange({ sessionId: "session", extraction: subtotalReading, selection: chosen }); h.render(); await h.advance(); };
  await update(); assert.equal(h.primary().children, "Next: expense details →"); assert.match(h.text(), /Explain why you changed/);
  chosen = { ...chosen, override_reason: "The original shows RM116.20; AI missed RM4.00." };
  await update(); assert.equal(h.input("amount").value, "116.20");
  await h.advance(); assert.equal(h.routes.at(-1), "/claims/draft/edit?step=review");
  const saved = h.api.calls.find(c => c[0] === "assisted")[1];
  assert.equal(saved.fields.amount, "116.20"); assert.equal(saved.selection.receipt_total, "112.20");
  assert.equal(saved.selection.override_reason, chosen.override_reason);
}));
test("Replacing a receipt does not silently reuse an AI plan tied to a removed original", () => withDom(async () => {
  const h = await harness({ claim, initialAttachments: [receipt], initialStep: 3,
    initialPlan: { session_id: "old-session", attachment_id: "removed-original", revision: 1, extraction: reading, selection } });
  await h.advance();
  assert.equal(h.api.calls.some(c => c[0] === "assisted"), false);
  assert.equal(h.api.calls[0][0], "ml_save_claim");
}));
test("A lost registration response is recovered only after confirming the exact uploaded path exists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  try {
    for (const registered of [true, false]) {
      const removed = [];
      const client = {
        auth: { getUser: async () => ({ data: { user: { id: "member" } } }) },
        rpc: async () => ({ error: new Error("Registration response lost") }),
        from: () => ({ select: () => ({ eq: async (_key, value) => {
          assert.match(value, /^member\/draft\/.+\.pdf$/);
          return { data: registered ? [{ id: "attachment" }] : [] };
        } }) }),
        storage: { from: () => ({ upload: async () => ({}), remove: async paths => { removed.push(...paths); return {}; } }) },
      };
      const api = await load("src/lib/api.ts", { "./supabase/client": { createClient: () => client }, "./domain": domain, "./browser-fetch": { browserFetch } });
      const file = { name: "receipt.pdf", type: "application/pdf", size: 100 };
      if (registered) { await api.uploadAttachment("draft", file, "receipt"); assert.equal(removed.length, 0); }
      else { await assert.rejects(api.uploadAttachment("draft", file, "receipt"), /Registration response lost/); assert.equal(removed.length, 1); }
    }
  } finally { globalThis.fetch = originalFetch; }
});
