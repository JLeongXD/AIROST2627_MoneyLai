import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reading, itemAnswers } from "./fixtures/receipt.mjs";

const require = createRequire(import.meta.url);
function load(file, imports = {}) {
  const m = new Module(path.resolve(file));
  m.filename = path.resolve(file);
  m.paths = require.resolve.paths("typescript");
  m.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, m.filename);
  return m.exports;
}
const queue = load("src/features/treasury/review-queue.ts");
const domain = load("src/lib/domain.ts");
const allocation = load("src/lib/ai/receipt-allocation.ts");
const budget = load("src/lib/budget.ts", { "./ai/receipt-allocation": allocation });
const BudgetNotice = load("src/components/BudgetNotice.tsx", { "@/lib/domain": domain, "@/lib/budget": budget, "./BudgetNotice.module.css": { default: {} } }).default;
const claim = {
  id: "claim-a", claimant_id: "member", activity_id: "workshop", amount: "85.00", description: "Workshop supplies",
  status: "submitted", purchase_date: "2026-11-20", category: "Materials", info_requested_at: null,
  created_at: "2026-11-20T10:00:00Z", submitted_at: "2026-11-21T10:00:00Z", updated_at: "2026-11-21T10:00:00Z",
  claimant: { display_name: "Amy" }, activity: { name: "Workshop" },
};

test("Review queues are exclusive across requests, revision drafts, resubmissions and history", () => {
  const claims = [claim,
    { ...claim, id: "waiting", status: "needs_info", info_requested_at: "2026-11-22" },
    { ...claim, id: "revision", status: "draft", info_requested_at: "2026-11-22" },
    { ...claim, id: "draft", status: "draft" },
    { ...claim, id: "resubmitted", info_requested_at: "2026-11-22" },
    ...["approved", "paid", "rejected", "cancelled"].map(status => ({ ...claim, id: status, status, info_requested_at: "2026-11-22" })),
  ];
  assert.deepEqual(queue.queueClaims(claims, "submitted").map(c => c.id), ["claim-a", "resubmitted"]);
  assert.deepEqual(queue.queueClaims(claims, "needs_info").map(c => c.id), ["waiting", "revision"]);
  assert.deepEqual(queue.queueClaims(claims, "approved").map(c => c.id), ["approved"]);
  assert.deepEqual(queue.queueClaims(claims, "history").map(c => c.id), ["paid", "rejected", "cancelled"]);
});

test("Queue links preserve encoded filters; work is oldest first and history newest first", () => {
  const recent = { ...claim, id: "recent", submitted_at: "2026-11-25", updated_at: "2026-11-25" };
  assert.deepEqual(queue.queueClaims([recent, claim], "submitted", " WORKSHOP ", "workshop").map(c => c.id), ["claim-a", "recent"]);
  assert.equal(queue.queueClaims([claim], "submitted", "Amy", "other").length, 0);
  assert.deepEqual(queue.queueClaims([{ ...claim, status: "paid" }, { ...recent, status: "paid" }], "history").map(c => c.id), ["recent", "claim-a"]);
  const params = new URLSearchParams(queue.treasuryQuery("approved", "Amy & Ben", "a/b"));
  assert.equal(params.get("search"), "Amy & Ben");
  assert.equal(params.get("activity"), "a/b");
  for (const invalid of [null, "toString", "__proto__", "invalid"]) assert.equal(queue.queueKey(invalid), "submitted");
});

function nodes(root) {
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
function Stub() { return null; }
function PaymentForm() { return null; }
function harness(overrides = {}, queueClaims = [claim, { ...claim, id: "claim-b" }], query = "queue=submitted&search=Amy&activity=workshop") {
  const slots = []; let cursor = 0; let tree;
  const calls = [];
  const hooks = { ...React, useState: initial => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
  } };
  const { default: Review } = load("src/features/treasury/TreasuryClaimReview.tsx", {
    react: hooks, "next/link": { default: Stub }, "next/navigation": { useSearchParams: () => new URLSearchParams(query) },
    "@/components/AuthProvider": { useAuth: () => ({ user: { id: "treasurer" } }) },
    "@/lib/useLoad": { useLoad: () => ({ data: queueClaims }) },
    "@/lib/api": { listClaims: async () => [], rpc: async (name, args) => { calls.push([name, args]); } },
    "@/lib/domain": domain, "./review-queue": queue,
    "@/lib/budget": budget, "@/components/BudgetNotice": { default: BudgetNotice },
    "@/components/UI": { Field: Stub, FileLink: Stub, Notice: Stub, StatusBadge: Stub },
    "@/components/ReceiptPreview": { default: Stub }, "@/components/AIClaimCheck": { default: Stub }, "@/components/DuplicateReceipts": { default: Stub },
    "@/components/ReceiptAllocation": { default: Stub }, "@/components/ClaimClarifications": { default: Stub },
    "./PaymentForm": { default: PaymentForm }, "./Treasury.module.css": { default: new Proxy({}, { get: (_, key) => key }) },
  });
  const props = { claim, attachments: [], events: [], payment: null, payout: null, receiptPlan: null,
    activity: { budget: 1000, remaining_budget: 1000 }, busy: false, pendingAction: null, error: "", message: "",
    onAction: async job => { await job(); }, onChanged: () => {}, ...overrides };
  function render() { cursor = 0; tree = Review(props); return tree; }
  render();
  return { calls, props, render, nodes: () => nodes(tree),
    button: text => nodes(tree).find(n => n.type === "button" && n.props.children === text),
    changeReason: value => nodes(tree).find(n => n.type === "textarea" && n.props.id === "review-reason").props.onChange({ target: { value } }),
    submit: async () => { await nodes(tree).find(n => n.type === "form" && n.props.id === "decision-form").props.onSubmit({ preventDefault() {} }); },
  };
}

test("Requesting information requires a specific question and sends the correct RPC", async () => {
  const h = harness();
  assert.equal(h.nodes().some(n => n.type === "textarea"), false);
  h.button("Request information").props.onClick(); h.render();
  assert.equal(h.button("Send request").props.disabled, true);
  h.changeReason(" Please clarify the club purpose. "); h.render();
  assert.equal(h.button("Send request").props.disabled, false);
  await h.submit();
  assert.deepEqual(h.calls, [["ml_request_information", { p_claim_id: claim.id, p_question: "Please clarify the club purpose." }]]);
});

test("Switching to rejection clears the question; cancellation never sends a decision", async () => {
  const h = harness();
  h.button("Request information").props.onClick(); h.render();
  h.changeReason("Question"); h.render();
  h.button("Reject claim").props.onClick(); h.render();
  assert.equal(h.button("Confirm rejection").props.disabled, true);
  h.changeReason("Personal expense"); h.render();
  const original = globalThis.confirm;
  try {
    globalThis.confirm = () => false; await h.submit(); assert.equal(h.calls.length, 0);
    globalThis.confirm = () => true; await h.submit();
    assert.deepEqual(h.calls, [["ml_review_claim", { p_claim_id: claim.id, p_decision: "rejected", p_reason: "Personal expense" }]]);
  } finally { globalThis.confirm = original; }
});

test("Approval retains confirmation and budget protection; waiting and approved claims have no review decision", async () => {
  const original = globalThis.confirm;
  try {
    const h = harness(); globalThis.confirm = () => true;
    await h.button("Approve RM\u00a085.00").props.onClick();
    assert.deepEqual(h.calls, [["ml_review_claim", { p_claim_id: claim.id, p_decision: "approved", p_reason: "" }]]);
    const blocked = harness({ activity: { remaining_budget: 10 } });
    assert.equal(blocked.nodes().find(n => n.type === "button" && String(n.props.children).startsWith("Approve ")).props.disabled, true);
    for (const status of ["needs_info", "approved", "paid", "rejected"]) {
      const view = harness({ claim: { ...claim, status } });
      assert.equal(view.nodes().some(n => n.type === "button" && n.props.children === "Reject claim"), false);
      assert.equal(view.nodes().some(n => n.type === PaymentForm), status === "approved");
    }
  } finally { globalThis.confirm = original; }
});

test("Treasurer sees RM5 shortfall for a RM15 claim, can request information, and can approve after budget is sufficient", () => {
  const h = harness({ claim: { ...claim, amount: "15.00" }, activity: { remaining_budget: "10.00" } });
  const budgetNode = h.nodes().find(n => n.type === BudgetNotice);
  const html = renderToStaticMarkup(budgetNode);
  assert.match(html, /role="alert"/); assert.match(html, /Available activity budget<\/dt><dd>RM\s*10\.00/);
  assert.match(html, /This claim<\/dt><dd>RM\s*15\.00/); assert.match(html, /Over budget by<\/dt><dd>RM\s*5\.00/);
  assert.match(html, /before approving/);
  assert.equal(h.button("Approve RM\u00a015.00").props.disabled, true);
  assert.equal(h.button("Request information").props.disabled, false);
  h.props.activity.remaining_budget = "15.00"; h.render();
  assert.equal(h.button("Approve RM\u00a015.00").props.disabled, false);
  assert.equal(h.nodes().some(n => n.type === BudgetNotice), false);
});

test("Review summary uses selected item purposes and keeps normal calculation explanations out of alerts", () => {
  const selection = { ...allocation.initialSelection(reading, "simple"), items: itemAnswers(reading.items), confirmed: true };
  selection.items[0].reason = "Drinks for workshop attendees";
  selection.items[1].reason = "Build the workshop prototype";
  selection.items[2].included = false; selection.items[2].reason = "Private camping purchase";
  const receiptPlan = { attachment_id: "receipt", extraction: reading, selection, calculation: allocation.calculateAllocation(reading, selection) };
  assert.ok(receiptPlan.calculation.adjustment_reason);
  const submitted = "Purchase of a long list of product model numbers including a private camping purchase.";
  const h = harness({ claim: { ...claim, amount: "80.00", description: submitted }, attachments: [{ id: "receipt", kind: "receipt" }], receiptPlan });
  const summary = h.nodes().find(n => n.type === "p" && n.props.className === "purpose").props.children;
  assert.match(summary, /Drinks for workshop attendees; Build the workshop prototype/);
  assert.doesNotMatch(summary, /Private camping/);
  const description = h.nodes().find(n => n.type === "details" && n.props.className === "descriptionDetails");
  assert.equal(description.props.open, undefined); assert.ok(JSON.stringify(description).includes(submitted));
  assert.equal(h.nodes().some(n => n.props?.className === "attentionRow"), false);
  assert.equal(h.nodes().filter(n => n.type === "button" && String(n.props.children).startsWith("Approve ")).length, 1);
});

test("Next claim preserves list context and skips the treasurer's own claims", () => {
  const own = { ...claim, id: "own", claimant_id: "treasurer" };
  const h = harness({ message: "Claim approved; awaiting payment.", claim: { ...claim, status: "approved" } }, [own, { ...claim, id: "claim-b" }]);
  const next = h.nodes().find(n => n.props?.children === "Open next claim");
  assert.equal(next.props.href, "/treasury/claim-b?queue=submitted&search=Amy&activity=workshop");
});

test("Direct links to resubmitted claims return to review rather than the old information request", () => {
  const h = harness({ claim: { ...claim, info_requested_at: "2026-11-20" } }, [claim, { ...claim, id: "claim-b" }], "");
  assert.equal(h.nodes().find(n => n.props?.children === "Open next claim").props.href, "/treasury/claim-b?queue=submitted");
});
