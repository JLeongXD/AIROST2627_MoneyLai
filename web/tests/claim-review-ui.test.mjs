import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reading, subtotalReading, itemAnswers } from "./fixtures/receipt.mjs";

const require = createRequire(import.meta.url);
async function load(file, imports = {}) {
  const m = new Module(path.resolve(file));
  m.filename = path.resolve(file);
  m.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, m.filename);
  return m.exports;
}
const domain = await load("src/lib/domain.ts");
const allocation = await load("src/lib/ai/receipt-allocation.ts");
const check = await load("src/lib/ai/claim-check.ts");
const coach = await load("src/lib/ai/coach.ts");
const styles = new Proxy({}, { get: (_, key) => String(key) });
const ui = {
  Notice: ({ children }) => React.createElement("aside", null, children),
  FileLink: ({ label }) => React.createElement("button", null, label),
};
const claim = { id: "claim", claimant_id: "member", status: "draft", amount: "100.00", purchase_date: reading.date, category: "Materials", description: "Workshop supplies", activity_id: "activity" };
const attachments = [{ id: "receipt", kind: "receipt", original_name: "receipt.jpg", storage_path: "member/receipt.jpg" }];
const selection = { ...allocation.initialSelection(reading), items: itemAnswers(reading.items), confirmed: true };
const plan = { extraction: reading, selection, calculation: allocation.calculateAllocation(reading, selection), revision: 2, updated_at: "2026-11-27T12:44:00Z", model: "test-model", attachment_id: "receipt" };
const warnings = [
  "Fresh AI item readings differ from the saved extraction. Check the original receipt and correction notes; this alone is not evidence of misuse.",
  "Document: invoice; payment: paid. Verify payment evidence.",
  "Member declared all purchases for the activity; review flagged item purposes.",
];
const report = check.compareClaim({ receipts: [{ attachment_id: "receipt", readable: true, merchant: reading.merchant, amount: reading.total, date: reading.date, currency: "MYR", note: "Fresh reading" }], purpose_clear: true, purpose_note: "Description matches the purchase.", warnings }, claim.amount, claim.purchase_date, plan);

async function renderCheck({ result = report, stale = false, status = "complete", reviewer = false, effects = [], reload = () => {} } = {}) {
  const { default: Component } = await load("src/components/AIClaimCheck.tsx", {
    react: { ...React, useEffect: effect => effects.push(effect) },
    "@/lib/supabase/client": {},
    "@/lib/useLoad": { useLoad: () => ({ data: { status, result, input_signature: stale ? "old" : check.checkSignature(claim, attachments, plan.revision), model: "test-model", created_at: new Date().toISOString() }, reload }) },
    "@/lib/ai/claim-check": check, "@/lib/ai/coach": coach, "@/lib/domain": domain,
    "./UI": ui, "./AIClaimCheck.module.css": { __esModule: true, default: styles },
    "./AuthProvider": { useAuth: () => ({ user: { id: "member" } }) },
    "./FeedbackProvider": { useFeedback: () => () => {}, useOperationError: () => ["", () => {}] },
    "next/link": ({ href, children }) => React.createElement("a", { href }, children),
  });
  return renderToStaticMarkup(React.createElement(Component, { claim, attachments, receiptPlan: plan, compact: true, reviewer, onChanged() {} }));
}

test("Pre-submit review shows matching checks before three distinct, actionable reminders", async () => {
  const html = await renderCheck();
  assert.ok(html.includes("2 checks match · 3 points to check"));
  assert.ok(html.indexOf("Amount") < html.indexOf("Please check before submitting"));
  for (const title of ["Check receipt items", "Check payment evidence", "Explain activity use"]) assert.equal(html.split(`<strong>${title}</strong>`).length - 1, 1);
  assert.ok(html.includes("payment status: paid"));
  assert.ok(html.includes("not evidence of misuse"));
  assert.ok(html.includes("Other purchase"));
  assert.ok(html.includes("Description is clear; activity use needs checking"));
  assert.ok(!html.includes("Review this finding") && !html.includes("Refresh results"));
  assert.ok(html.includes('<details class="details"><summary>Check details</summary>'));
  assert.ok(html.includes("Google Gemini") && html.includes("bank details are excluded"));
});

test("Clean checks do not fabricate reminders, and stale results remain labelled as previous", async () => {
  const clean = { ...report, warnings: [], needs_attention: false };
  const html = await renderCheck({ result: clean });
  assert.ok(html.includes("3 checks match · 0 points to check"));
  assert.ok(!html.includes("Please check before submitting"));
  const stale = await renderCheck({ stale: true });
  assert.ok(stale.includes("Outdated") && stale.includes("Previous check"));
  assert.ok(!stale.includes("Saved items needing clarification"));
  const reviewer = await renderCheck({ reviewer: true });
  assert.equal(reviewer.split("<strong>Check payment evidence</strong>").length - 1, 1);
});

test("Treasurer AI review leads with a short summary and folds grouped evidence without discarding it", async () => {
  const findings = coach.coachFindings({ ...report, purpose_clear: false, purpose_note: "Explain how the supplies were used.",
    warnings: [...warnings, "The document heading says invoice but shows EWALLET payment.", "Verify document readability, type and payment evidence."] }, "100.00", plan);
  const groups = coach.reviewFindingGroups(findings);
  assert.equal(groups.length, 3);
  assert.equal(groups.find(g => g.title === "Clarify activity purpose").findings.length, 2);
  assert.equal(groups.find(g => g.title === "Check payment evidence").findings.length, 3);
  for (const finding of findings) assert.ok(groups.some(g => g.findings.some(f => f.evidence === finding.evidence)));
  const html = await renderCheck({ reviewer: true });
  const details = html.indexOf("<details><summary>View AI details &amp; tools</summary>");
  assert.ok(details > 0); assert.ok(html.indexOf("Amount: Matches") < details);
  assert.ok(html.indexOf("Date: Matches") < details); assert.ok(html.indexOf("Purpose: Needs review") < details);
  assert.ok(html.indexOf("Saved items needing clarification") > details);
  assert.doesNotMatch(html, /<details open/);
});

test("Duplicate checks stay folded, show claim codes and prioritize paid and approved matches", async () => {
  const matches = [
    { claim_id: "pending", status: "submitted", amount: "30.00", basis: "identical_file", current_file: "receipt.jpg", matched_file: "copy.jpg" },
    { claim_id: "paid", status: "paid", amount: "30.00", basis: "identical_file", current_file: "receipt.jpg", matched_file: "paid.jpg" },
    { claim_id: "approved", status: "approved", amount: "20.00", basis: "identical_file", current_file: "receipt.jpg", matched_file: "approved.jpg" },
  ];
  const { default: Component } = await load("src/components/DuplicateReceipts.tsx", {
    "next/link": { default: ({ href, children }) => React.createElement("a", { href }, children) }, "@/lib/api": {},
    "@/lib/useLoad": { useLoad: () => ({ data: matches, reload: () => {} }) }, "@/lib/domain": domain, "./UI": ui,
    "./FeedbackProvider": { useFeedback: () => () => {}, useOperationError: () => ["", () => {}] },
    "./DuplicateReceipts.module.css": { default: styles },
  });
  const claims = matches.map((m, i) => ({ ...claim, id: m.claim_id, claim_number: i + 1, claimant: { display_name: "Amy" } }));
  const html = renderToStaticMarkup(React.createElement(Component, { claimId: "current", compact: true, embedded: true, claims }));
  assert.match(html, /3 possible matching claims · 2 approved or reimbursed/);
  assert.ok(html.indexOf("ML-000002") < html.indexOf("ML-000003"));
  assert.ok(html.indexOf("ML-000003") < html.indexOf("ML-000001"));
  assert.match(html, /Amy/); assert.match(html, /Same receipt file/);
  assert.match(html, /not proof of duplicate reimbursement/);
  assert.doesNotMatch(html, /SHA-256|<details open|Index this claim/);
  assert.match(html, /Recheck duplicate receipts/);
});

test("Running results poll automatically and stop polling when the effect is cleaned up", async () => {
  const effects = [];
  let tick, cleared, refreshes = 0;
  const previousWindow = globalThis.window;
  globalThis.window = { setInterval: (callback, delay) => { assert.equal(delay, 4000); tick = callback; return 42; }, clearInterval: id => { cleared = id; } };
  try {
    const html = await renderCheck({ status: "running", effects, reload: () => refreshes++ });
    assert.ok(html.includes("Checking receipts…") && html.includes("Results update automatically"));
    const cleanup = effects[0]();
    tick();
    assert.equal(refreshes, 1);
    cleanup();
    assert.equal(cleared, 42);
  } finally { globalThis.window = previousWindow; }
});

test("Receipt amount summary keeps corrections available and never confirms an invalid source", async () => {
  const { default: Component } = await load("src/components/ReceiptAllocation.tsx", {
    "next/link": ({ children }) => React.createElement("a", null, children), "./UI": ui,
    "@/lib/domain": domain, "./ReceiptAssistant.module.css": { __esModule: true, default: styles },
  });
  const render = props => renderToStaticMarkup(React.createElement(Component, { plan, claimed: claim.amount, sourceValid: true, canEdit: false, ...props }));
  const html = render({});
  assert.ok(html.includes("Your claim matches the saved receipt total"));
  assert.ok(html.includes('<details class="disclosure"><summary>View items &amp; corrections</summary>'));
  assert.ok(html.includes("not independent AI verification") && html.includes("Revision 2"));
  assert.ok(!render({ sourceValid: false }).includes("Your claim matches"));
  assert.ok(render({ claimed: "90.00" }).includes("Amount difference"));
  const raw = { ...subtotalReading, total: "113.20" };
  const selected = { ...allocation.initialSelection(raw, "simple"), items: itemAnswers(raw.items) }; selected.items[1].included = false; selected.items[1].reason = "Personal";
  const confirmed = allocation.confirmSelectedItemAmount(selected);
  const partialPlan = { ...plan, extraction: raw, selection: confirmed, calculation: allocation.calculateAllocation(raw, confirmed) };
  const partial = render({ plan: partialPlan, claimed: "84.30" });
  assert.match(partial, /Selected item subtotal: RM\s*84\.30/);
  assert.match(partial, /Excluded items: RM\s*27\.90/);
  assert.match(partial, /Manually confirmed; check the reason and original/);
  assert.match(partial, /No extra adjustments are claimed/);
  assert.match(partial, /Do not interpret unknown charges as zero/);
  const raised = { ...allocation.initialSelection(subtotalReading, "simple"), items: itemAnswers(subtotalReading.items), confirmed: true,
    claimed_amount: "116.20", override_reason: "AI missed RM4.00. Please check the original." };
  const correctedPlan = { ...plan, extraction: subtotalReading, selection: raised, calculation: allocation.calculateAllocation(subtotalReading, raised) };
  const corrected = render({ plan: correctedPlan, claimed: "116.20" });
  assert.match(corrected, /AI-read receipt total: RM\s*112\.20/);
  assert.match(corrected, /Difference from automatic calculation: \+RM\s*4\.00/);
  assert.match(corrected, /Correction reason: AI missed RM4.00/);
  assert.match(corrected, /Member-corrected amount/);
  assert.match(corrected, /exceeds the AI-read receipt total/);
});

test("Unknown warnings remain visible and missing item details are not invented", () => {
  const findings = coach.coachFindings({ ...report, warnings: [...warnings, "Check supplier details", "Check supplier details"] }, "100.00");
  assert.equal(findings.filter(f => f.evidence === "Check supplier details").length, 1);
  assert.ok(findings.find(f => f.title === "Explain activity use").evidence.includes("without identifying specific items"));
});
