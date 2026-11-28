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
const core = await load("src/lib/ai/receipt-allocation.ts");
const audit = await load("src/lib/ai/claim-check.ts");
const reader = await load("src/lib/ai/receipt-reader.ts", { "server-only": {}, "./receipt-allocation": core });
const budget = await load("src/lib/budget.ts", { "./ai/receipt-allocation": core });
const BudgetNotice = (await load("src/components/BudgetNotice.tsx", { "@/lib/domain": await load("src/lib/domain.ts"), "@/lib/budget": budget, "./BudgetNotice.module.css": { default: {} } })).default;
const confirm = (r, mode = "auto") => ({ ...core.initialSelection(r, mode), items: itemAnswers(r.items), confirmed: true });
async function loadAssistant(react = React) {
  return (await load("src/components/ReceiptAssistant.tsx", {
    react,
    "./BudgetNotice": { default: BudgetNotice },
    "next/link": { default: ({ children }) => children },
    "./UI": { Field: ({ label, children }) => React.createElement("div", null, label, children), Notice: ({ children }) => React.createElement("p", null, children) },
    "./FeedbackProvider": { useFeedback: () => () => {} }, "@/lib/supabase/client": {}, "@/lib/api": {},
    "@/lib/domain": await load("src/lib/domain.ts"), "@/lib/ai/receipt-allocation": core, "./ReceiptAssistant.module.css": { default: {} },
  })).default;
}

test("Receipt picker keeps one filename, toggles inline preview and requires consent before AI reading", async () => {
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const slots = []; let cursor = 0, pickerOpened = 0, changedFile;
  const slot = initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return i; };
  const hooks = { ...React, useEffect: () => {}, useRef: value => slots[slot({ current: value })], useState: value => {
    const i = slot(value); return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  const Assistant = await loadAssistant(hooks);
  const props = { activityId: "a", initialPlan: null, onChange: () => {}, onBusyChange: () => {}, onFileChange: value => { changedFile = value; } };
  let tree;
  const render = () => { cursor = 0; tree = Assistant(props); };
  const byId = id => nodes(tree).find(n => n.props?.id === id);
  const button = label => nodes(tree).find(n => n.type === "button" && n.props.children === label);
  render();
  assert.equal(byId("receipt-file-input").props.hidden, true);
  byId("receipt-file-input").props.ref.current = { click: () => pickerOpened++ };
  button("Choose file").props.onClick(); assert.equal(pickerOpened, 1);
  const png = new File(["receipt"], "receipt.png", { type: "image/png" });
  byId("receipt-file-input").props.onChange({ target: { files: [png], value: "receipt.png" } }); render();
  assert.equal(changedFile, png); assert.ok(button("Change"));
  assert.equal(renderToStaticMarkup(tree).split("receipt.png").length - 1, 1);
  assert.equal(byId("receipt-preview").props.hidden, true);
  assert.equal(button("Read receipt with AI").props.disabled, true);
  button("Preview").props.onClick(); render();
  assert.equal(byId("receipt-preview").props.hidden, false);
  button("Hide preview").props.onClick(); render();
  assert.equal(byId("receipt-preview").props.hidden, true);
  nodes(tree).find(n => n.type === "input" && n.props.type === "checkbox").props.onChange({ target: { checked: true } }); render();
  assert.equal(button("Read receipt with AI").props.disabled, false);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /<h3 id="receipt-ai-heading">Fill details with AI<\/h3>/);
  assert.doesNotMatch(html, /Upload privacy|<details/);
  assert.match(html, /Google Gemini/); assert.match(html, /Bank details are excluded/);
  const oldPreview = nodes(tree).find(n => n.type === "img").props.src;
  byId("receipt-file-input").props.onChange({ target: { files: [new File(["pdf"], "receipt.pdf", { type: "application/pdf" })], value: "receipt.pdf" } }); render();
  assert.equal(byId("receipt-preview").props.hidden, true);
  const pdfPreview = nodes(tree).find(n => n.type === "iframe").props.src;
  URL.revokeObjectURL(oldPreview); URL.revokeObjectURL(pdfPreview);
});
test("Receipt UI offers two scopes, hides full-claim allocation and collapses routine partial settings", async () => {
  const Assistant = await loadAssistant();
  const raw = { ...reading, items: reading.items.slice(0, 2), total: "80.00" };
  const render = mode => renderToStaticMarkup(React.createElement(Assistant, { activityId: "a", initialPlan: { session_id: "s", extraction: raw, selection: { ...core.initialSelection(raw, mode === "proportional" ? "auto" : mode), mode } }, onChange: () => {}, onBusyChange: () => {} }));
  const full = render("full"), partial = render("auto");
  assert.equal((full.match(/type="radio"/g) ?? []).length, 2);
  assert.match(full, /Final paid receipt total/); assert.equal(full.includes('id="allocation-mode"'), false);
  assert.equal(full.includes('id="line-0"'), false); assert.match(partial, /[Rr]eimbursement/);
  assert.equal((full.match(/aria-required="true"/g) ?? []).length, raw.items.length);
  assert.equal((partial.match(/aria-required="true"/g) ?? []).length, raw.items.length);
  assert.equal(partial.includes('<details open='), false);
  for (const mode of ["auto", "manual", "proportional", "simple"]) {
    const html = render(mode);
    assert.equal(html.includes("<select"), false);
    assert.equal(html.includes('id="line-0"'), false);
    assert.match(html, /Change reimbursement amount|Use automatic amount/);
  }
  const taxed = { ...raw, total: "84.80", tax: "4.80", line_amount_basis: "net" };
  const chosen = core.initialSelection(taxed, "simple"); chosen.items[1].included = false; chosen.items[1].reason = "Personal";
  const html = renderToStaticMarkup(React.createElement(Assistant, { activityId: "a", initialPlan: { session_id: "s", extraction: taxed, selection: chosen }, onChange: () => {}, onBusyChange: () => {} }));
  assert.match(html, /tax is allocated across all items in proportion to their amounts by default/);
  assert.match(html, /Automatic reimbursement:/); assert.equal(html.includes("AI could not verify"), false);
});

test("Receipt budget warnings follow the selected or corrected reimbursement rather than the full receipt", async () => {
  const Assistant = await loadAssistant();
  const raw = { ...reading, total: "15.00", items: [{ ...reading.items[0], amount: "6.00" }, { ...reading.items[1], amount: "9.00" }] };
  const selected = confirm(raw, "simple");
  const render = selection => renderToStaticMarkup(React.createElement(Assistant, { activityId: "a", availableBudget: "10.00",
    initialPlan: { session_id: "s", extraction: raw, selection }, onChange: () => {}, onBusyChange: () => {} }));
  assert.match(render(selected), /Over budget by<\/dt><dd>RM\s*5\.00/);
  const excluded = { ...selected, items: selected.items.map((i, index) => index === 1 ? { ...i, included: false, reason: "Private purchase" } : i) };
  assert.doesNotMatch(render(excluded), /Activity budget insufficient/);
  assert.match(render({ ...excluded, claimed_amount: "15.00", override_reason: "The AI missed a selected activity charge." }), /Over budget by<\/dt><dd>RM\s*5\.00/);
  assert.doesNotMatch(render({ ...selected, claimed_amount: "8.00", override_reason: "Only claiming the activity share." }), /Activity budget insufficient/);
});

test("Simple override retains automatic baseline, validates positive amounts and refuses false AI passes", () => {
  const raw = { ...reading, items: reading.items.slice(0, 2), total: "80.00" };
  const chosen = confirm(raw, "simple"); chosen.items[1].included = false; chosen.items[1].reason = "Personal";
  const result = core.calculateAllocation(raw, chosen);
  assert.equal(result.expected_amount, "30.00"); assert.equal(result.automatic_amount, "30.00");
  for (const claimed_amount of ["", "0", "-1", "NaN", "1.001", "10000000000"]) assert.throws(() => core.calculateAllocation(raw, { ...chosen, claimed_amount, override_reason: "Read original." }));
  assert.throws(() => core.calculateAllocation(raw, { ...chosen, claimed_amount: "32.00", override_reason: "" }), /Explain/);
  const corrected = core.calculateAllocation(raw, { ...chosen, claimed_amount: "32.00", override_reason: "Original has a charge AI did not read." });
  assert.equal(corrected.expected_amount, "32.00"); assert.equal(corrected.automatic_amount, "30.00");
  const fresh = { receipts: [{ readable: true, amount: "80.00", currency: "MYR", date: raw.date }], purpose_clear: true, purpose_note: "", warnings: [] };
  const checked = audit.compareClaim(fresh, "32.00", raw.date, { extraction: raw, selection: chosen, calculation: corrected, revision: 1 });
  assert.equal(checked.amount_status, "mismatch"); assert.equal(checked.allocation.difference, "2.00");
  const unclear = { ...raw, total: "81.19", tax: null, line_amount_basis: "unknown" };
  const unresolved = { ...chosen, receipt_total: unclear.total };
  assert.throws(() => core.calculateAllocation(unclear, unresolved), /could not verify/);
  const manual = core.calculateAllocation(unclear, { ...unresolved, claimed_amount: "32.00", override_reason: "Checked original; selected goods with tax are 32." });
  assert.equal(manual.automatic_amount, null); assert.equal(manual.tax, null); assert.ok(manual.automatic_issue);
  assert.equal(audit.compareClaim(fresh, "32.00", raw.date, { extraction: unclear, selection: chosen, calculation: manual, revision: 1 }).amount_status, "unable_to_verify");
  assert.throws(() => core.calculateAllocation(raw, { ...chosen, items: chosen.items.map(i => ({ ...i, amount: "999.00" })), claimed_amount: "32.00", override_reason: "Override" }), /original item/);
});

test("Reconciled original totals use the selected subtotal even when adjustment absence is unknown", () => {
  for (const receipt of [subtotalReading, { ...subtotalReading, adjustment_treatment: undefined },
    { ...subtotalReading, tax: "0.00", discount: "0.00", rounding: "0.00" }]) {
    const chosen = confirm(receipt, "simple"); chosen.items[1].included = false; chosen.items[1].reason = "Personal";
    const before = structuredClone(receipt);
    const result = core.calculateAllocation(receipt, chosen);
    assert.equal(result.expected_amount, "84.30"); assert.equal(result.automatic_amount, "84.30");
    assert.equal(result.selected_subtotal, "84.30"); assert.equal(result.excluded_subtotal, "27.90");
    assert.equal(result.automatic_issue, null); assert.equal(result.tax, "0.00"); assert.equal(result.discount, "0.00");
    assert.deepEqual(receipt, before);
  }
});

test("Members may correct reimbursements above or below the AI total while retaining the review baseline", async () => {
  const raw = structuredClone(subtotalReading), original = structuredClone(raw);
  const Assistant = await loadAssistant();
  for (const [claimed_amount, difference] of [["116.20", "4.00"], ["108.20", "-4.00"]]) {
    const chosen = { ...confirm(raw, "simple"), claimed_amount, override_reason: "The AI misread the amount; please check the original." };
    const calculation = core.calculateAllocation(raw, chosen);
    assert.equal(calculation.expected_amount, claimed_amount); assert.equal(calculation.automatic_amount, "112.20");
    assert.equal(calculation.raw_receipt_total, "112.20"); assert.equal(calculation.receipt_total, "112.20");
    assert.match(calculation.correction_reason, /AI misread the amount/);
    if (difference === "4.00") assert.ok(calculation.issues.some(i => /exceeds the AI-read receipt total by RM 4.00.*Pending Treasurer review/.test(i)));
    const plan = { extraction: raw, selection: chosen, calculation, revision: 1, session_id: "s" };
    const fresh = { receipts: [{ readable: true, amount: raw.total, currency: "MYR", date: raw.date }], purpose_clear: true, purpose_note: "", warnings: [] };
    const checked = audit.compareClaim(fresh, claimed_amount, raw.date, plan);
    assert.equal(checked.amount_status, "mismatch"); assert.equal(checked.allocation.difference, difference);
    assert.equal(checked.needs_attention, true);
    const html = renderToStaticMarkup(React.createElement(Assistant, { activityId: "a", initialPlan: plan, onChange: () => {}, onBusyChange: () => {} }));
    assert.match(html, /pending Treasurer review/); assert.match(html, /Difference from automatic calculation:/);
    assert.doesNotMatch(html, /cannot exceed/);
    if (difference === "4.00") {
      assert.match(html, /\+RM\s*4\.00/); assert.match(html, /You can continue after entering a reason and confirming/);
    }
    assert.throws(() => core.calculateAllocation(raw, { ...chosen, override_reason: " " }), /Explain/);
    assert.throws(() => core.calculateAllocation(raw, { ...chosen, confirmed: false }), /Confirm/);
  }
  assert.deepEqual(raw, original);
  const unclear = { ...raw, tax: "1.00" };
  const corrected = core.calculateAllocation(unclear, { ...confirm(unclear, "simple"), claimed_amount: "116.20", override_reason: "Original shows a higher amount." });
  assert.equal(corrected.expected_amount, "116.20"); assert.equal(corrected.automatic_amount, null);
  assert.ok(corrected.automatic_issue); assert.equal(corrected.tax, null);
  const underread = { ...raw, total: "108.20" };
  const selected = core.confirmSelectedItemAmount(confirm(underread, "simple"));
  assert.equal(core.calculateAllocation(underread, selected).expected_amount, "112.20");
});

test("Unresolved adjustments require explicit subtotal confirmation and retain review evidence", () => {
  for (const receipt of [{ ...subtotalReading, total: "113.20" }, { ...subtotalReading, tax: "1.00" }]) {
    const chosen = confirm(receipt, "simple"); chosen.items[1].included = false; chosen.items[1].reason = "Personal";
    assert.throws(() => core.calculateAllocation(receipt, chosen), /could not verify/);
    const confirmed = core.confirmSelectedItemAmount(chosen);
    assert.equal(confirmed.confirmed, true); assert.equal(confirmed.claimed_amount, "84.30");
    assert.match(confirmed.override_reason, /84.30.*27.90/);
    const result = core.calculateAllocation(receipt, confirmed);
    assert.equal(result.expected_amount, "84.30"); assert.equal(result.automatic_amount, null);
    assert.equal(result.selected_subtotal, "84.30"); assert.equal(result.excluded_subtotal, "27.90");
    assert.equal(result.tax, null); assert.equal(result.discount, null); assert.equal(result.rounding, null);
    assert.match(result.automatic_issue, /tax/); assert.match(result.correction_reason, /84.30.*27.90/);
    assert.ok(result.issues.some(i => i.includes("manually confirmed")));
    const fresh = { receipts: [{ readable: true, amount: receipt.total, currency: "MYR", date: receipt.date }], purpose_clear: true, purpose_note: "", warnings: [] };
    assert.equal(audit.compareClaim(fresh, "84.30", receipt.date, { extraction: receipt, selection: confirmed, calculation: result, revision: 1 }).amount_status, "unable_to_verify");
  }
  const chosen = confirm(subtotalReading, "simple"); chosen.items[1].included = false;
  for (const invalid of [{ ...chosen, receipt_total: "0.00" }, { ...chosen, items: chosen.items.map(i => ({ ...i, included: false })) },
    { ...chosen, items: chosen.items.map(i => ({ ...i, amount: "" })) }]) assert.throws(() => core.confirmSelectedItemAmount(invalid), /Check the selected/);
  const confirmed = core.confirmSelectedItemAmount(chosen);
  assert.throws(() => core.calculateAllocation(subtotalReading, { ...confirmed, items: confirmed.items.map(i => ({ ...i, amount: "1.00" })) }), /original item/);
  const unresolved = { ...subtotalReading, total: "113.20" };
  assert.throws(() => core.calculateAllocation(unresolved, { ...confirmed, receipt_total: "112.20" }), /Explain the receipt total/);
});

test("Receipt UI offers one-click subtotal confirmation, shows the cause and clears stale confirmations", async () => {
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const slots = []; let cursor = 0, latest;
  const slot = initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return index; };
  const hooks = { ...React, useEffect: () => {}, useRef: value => slots[slot({ current: value })], useState: value => {
    const i = slot(value); return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  const Assistant = await loadAssistant(hooks), receipt = { ...subtotalReading, total: "113.20" };
  const props = { activityId: "activity", initialPlan: { session_id: "session", extraction: receipt, selection: core.initialSelection(receipt, "simple") },
    onChange: value => { latest = value; }, onBusyChange: () => {} };
  const render = () => { cursor = 0; return Assistant(props); };
  let tree = render();
  const itemCheckbox = (tree, index) => nodes(nodes(tree).filter(n => n.type === "article")[index]).find(n => n.type === "input" && n.props.type === "checkbox");
  nodes(tree).find(n => n.type === "input" && n.props.id === "line-reason-0").props.onChange({ target: { value: "Cleaning the club workshop" } }); tree = render();
  nodes(tree).find(n => n.type === "button" && String(n.props.children).startsWith("Apply this purpose")).props.onClick(); tree = render();
  assert.equal(latest.selection.items[1].reason, "Cleaning the club workshop");
  itemCheckbox(tree, 1).props.onChange({ target: { checked: false } }); tree = render();
  assert.equal(latest.selection.items[1].reason, "");
  assert.equal(nodes(tree).some(n => n.type === "button" && String(n.props.children).startsWith("Apply this purpose")), false);
  for (const [index, value] of [[0, "Cleaning the club workshop"], [1, "Personal purchase outside this activity"]]) {
    nodes(tree).find(n => n.type === "input" && n.props.id === `line-reason-${index}`).props.onChange({ target: { value } }); tree = render();
  }
  const text = JSON.stringify(tree);
  assert.match(text, /Check whether tax is included/);
  assert.equal(text.includes("AI could not verify the allocation."), false);
  const button = nodes(tree).find(n => n.type === "button" && JSON.stringify(n.props.children).includes("I confirm this amount"));
  assert.ok(button); assert.match(JSON.stringify(button.props.children), /84.30/);
  button.props.onClick(); tree = render();
  assert.equal(latest.selection.claimed_amount, "84.30"); assert.equal(latest.selection.confirmed, true);
  assert.equal(core.calculateAllocation(receipt, latest.selection).expected_amount, "84.30");
  nodes(tree).find(n => n.type === "input" && n.props.id === "reimbursement-amount").props.onChange({ target: { value: "85.00" } }); tree = render();
  assert.equal(latest.selection.override_reason, ""); assert.equal(latest.selection.confirmed, false);
  itemCheckbox(tree, 1).props.onChange({ target: { checked: true } }); render();
  assert.equal(latest.selection.claimed_amount, undefined); assert.equal(latest.selection.override_reason, "");
  assert.equal(latest.selection.confirmed, false);
});

test("Every selected item needs an activity purpose and every excluded item needs its own reason", () => {
  for (const mode of ["full", "simple", "auto", "manual", "proportional"]) {
    const chosen = confirm(reading, mode);
    if (mode === "manual" || mode === "proportional") chosen.adjustment_reason = "All item prices include tax.";
    chosen.items[0].reason = " "; // AI considers this likely_activity, but the user still must answer.
    assert.throws(() => core.calculateAllocation(reading, chosen), /activity purpose.*Water/);
    assert.match(core.receiptItemReasonError(reading, chosen, 0), /activity purpose/);
    if (mode === "full") continue;
    chosen.items[0].included = false;
    assert.throws(() => core.calculateAllocation(reading, chosen), /Explain why.*excluded/);
    assert.match(core.receiptItemReasonError(reading, chosen, 0), /excluded/);
    chosen.items[0].reason = "Purchased for a different activity";
    assert.equal(core.calculateAllocation(reading, chosen).expected_amount, "70.00");
  }
  const chosen = core.initialSelection(reading, "simple");
  assert.equal(core.automaticReceiptAllocation(reading, chosen).expected_amount, "100.00");
  assert.throws(() => core.calculateAllocation(reading, core.confirmSelectedItemAmount(chosen)), /activity purpose/);
});

test("Generated purpose uses only claimed items and member answers, grouping shared purposes", () => {
  const raw = { ...subtotalReading, merchant: "MR D.I.Y.", suggested_description: "Oil towels, garbage bags and tarpaulin canvas for outdoor camping",
    items: [{ ...reading.items[0], description: "Oil absorb towels", amount: "29.70" },
      { ...reading.items[1], description: "Garbage bags", amount: "31.80" },
      { ...reading.items[2], description: "Kitchen towels", amount: "22.80" },
      { ...reading.items[2], id: "4", description: "Tarpaulin canvas", amount: "27.90" }] };
  const chosen = confirm(raw, "simple");
  chosen.items[0].reason = chosen.items[1].reason = "Cleaning the robotics workshop and collecting activity waste";
  chosen.items[2].included = chosen.items[3].included = false;
  chosen.items[2].reason = chosen.items[3].reason = "For a separate personal camping trip";
  const description = core.receiptPurposeDescription(raw, chosen);
  assert.match(description, /MR D.I.Y./); assert.match(description, /Oil absorb towels, Garbage bags/);
  assert.match(description, /Cleaning the robotics workshop and collecting activity waste/);
  assert.equal((description.match(/Cleaning the robotics/g) ?? []).length, 1);
  assert.doesNotMatch(description, /Tarpaulin|Kitchen towels|camping/);
  chosen.items[0].reason = "清理工作坊活动场地";
  assert.match(core.receiptPurposeDescription(raw, chosen), /清理工作坊活动场地/);
  chosen.items[0].reason = "Detailed workshop purpose ".repeat(30);
  const long = core.receiptPurposeDescription(raw, chosen);
  assert.ok(long.length <= 500); assert.match(long, /Full item purposes are saved in the receipt details/);
  assert.equal(chosen.items[0].reason.length > 500, true);
});

test("Full receipt uses paid total despite incomplete lines, retains unknown charges, and requires a correction reason", () => {
  const raw = { ...reading, total: "21.00", items: [], tax: null, discount: null, rounding: null };
  const c = core.calculateAllocation(raw, confirm(raw, "full"));
  assert.equal(c.expected_amount, "21.00"); assert.equal(c.tax, null); assert.equal(c.method, "full");
  assert.throws(() => core.calculateAllocation(raw, { ...confirm(raw, "full"), receipt_total: "22.00" }), /Explain/);
  const corrected = core.calculateAllocation(raw, { ...confirm(raw, "full"), receipt_total: "22.00", correction_reason: "Original reads 22." });
  const fresh = { receipts: [{ readable: true, amount: "21.00", currency: "MYR", date: raw.date }], purpose_clear: true, purpose_note: "", warnings: [] };
  const result = audit.compareClaim(fresh, "22.00", raw.date, { extraction: raw, selection: confirm(raw, "full"), calculation: corrected, revision: 1 });
  assert.equal(result.amount_status, "mismatch"); assert.equal(result.allocation.expected_amount, "21.00");
});
test("Llaollao net 19.81 and inclusive 21 both reimburse 21 without deducting item discount twice", () => {
  for (const inclusive of [true, false]) {
    const raw = { ...reading, total: "21.00", tax: "1.19", discount: "1.90", rounding: "0.00",
      items: [{ ...reading.items[0], amount: inclusive ? "21.00" : "19.81" }],
      adjustment_treatment: { tax: inclusive ? "included" : "additional", discount: "included", rounding: "none", uniform: true } };
    const before = structuredClone(raw);
    const result = core.calculateAllocation(raw, confirm(raw));
    assert.equal(result.expected_amount, "21.00"); assert.equal(result.discount, "0.00");
    assert.equal(result.tax, inclusive ? "0.00" : "1.19"); assert.deepEqual(raw, before);
  }
});
test("Partial percentage allocation shares global discounts, tax and signed rounding using sen", () => {
  const raw = { ...reading, total: "95.42", tax: "5.40", discount: "10.00", rounding: "0.02",
    items: [{ ...reading.items[0], amount: "60.00" }, { ...reading.items[1], amount: "40.00" }],
    adjustment_treatment: { tax: "additional", discount: "additional", rounding: "additional", uniform: true } };
  const s = confirm(raw); s.items[1].included = false; s.items[1].reason = "Personal";
  const result = core.calculateAllocation(raw, s);
  assert.equal(result.tax, "3.24"); assert.equal(result.discount, "6.00"); assert.equal(result.rounding, "0.01"); assert.equal(result.expected_amount, "57.25");
  assert.throws(() => core.calculateAllocation(raw, { ...s, adjustment_treatment: { ...s.adjustment_treatment, uniform: false } }), /uniformly/);
});
test("No-adjustment receipts work without extra input; unexplained gaps cannot be silently made tax", () => {
  const raw = { ...reading, items: reading.items.slice(0, 2), total: "80.00", tax: null, discount: null, rounding: null,
    adjustment_treatment: { tax: "none", discount: "none", rounding: "none", uniform: false } };
  const s = confirm(raw); s.items[1].included = false; s.items[1].reason = "Personal";
  assert.equal(core.calculateAllocation(raw, s).expected_amount, "30.00");
  assert.throws(() => core.calculateAllocation({ ...raw, total: "81.19" }, { ...s, receipt_total: "81.19" }), /do not assume/);
  assert.throws(() => core.calculateAllocation({ ...raw, tax: "1.19", adjustment_treatment: { ...raw.adjustment_treatment, tax: "unknown" } }, { ...s, tax: "1.19", adjustment_treatment: { ...s.adjustment_treatment, tax: "unknown" } }), /not automatically tax/);
  assert.throws(() => core.calculateAllocation(raw, { ...s, adjustment_treatment: { ...s.adjustment_treatment, tax: "additional" }, tax: "1.19" }), /Explain/);
});

test("Selected items default receipt-level tax to all goods without requiring uniform confirmation", () => {
  const raw = { ...reading, total: "106.00", tax: "6.00", line_amount_basis: "net",
    items: [{ ...reading.items[0], amount: "60.00" }, { ...reading.items[1], amount: "40.00" }] };
  for (const tax_scope of [undefined, "unknown", "all_items"]) {
    const receipt = { ...raw, ...(tax_scope ? { adjustment_treatment: { tax: "additional", discount: "none", rounding: "none", uniform: false, tax_scope } } : {}) };
    const chosen = confirm(receipt, "simple"); chosen.items[1].included = false; chosen.items[1].reason = "Personal";
    const before = structuredClone(receipt);
    const result = core.calculateAllocation(receipt, chosen);
    assert.equal(result.expected_amount, "63.60"); assert.equal(result.automatic_amount, "63.60");
    assert.equal(result.tax, "3.60"); assert.equal(result.automatic_issue, null);
    assert.match(result.adjustment_reason, /tax is allocated across all items/);
    assert.deepEqual(receipt, before);
    const fresh = { receipts: [{ readable: true, amount: raw.total, currency: "MYR", date: raw.date }], purpose_clear: true, purpose_note: "", warnings: [] };
    assert.equal(audit.compareClaim(fresh, "63.60", raw.date, { extraction: receipt, selection: chosen, calculation: result, revision: 1 }).amount_status, "match");
    const mismatch = { ...receipt, total: "107.00" };
    const unresolved = { ...chosen, receipt_total: "107.00" };
    assert.throws(() => core.calculateAllocation(mismatch, unresolved), /could not verify/);
    assert.match(core.calculateAllocation(mismatch, { ...unresolved, claimed_amount: "63.60", override_reason: "Checked the original." }).automatic_issue, /do not assume/);
  }
});

test("Included tax is never added twice; explicit mixed tax blocks partial receipt-level allocation", () => {
  const raw = { ...reading, total: "106.00", tax: "6.00",
    items: [{ ...reading.items[0], amount: "63.60" }, { ...reading.items[1], amount: "42.40" }],
    adjustment_treatment: { tax: "included", discount: "none", rounding: "none", uniform: false, tax_scope: "mixed" } };
  const chosen = confirm(raw, "simple"); chosen.items[1].included = false; chosen.items[1].reason = "Personal";
  const included = core.calculateAllocation(raw, chosen);
  assert.equal(included.expected_amount, "63.60"); assert.equal(included.tax, "0.00");
  const mixed = { ...raw, line_amount_basis: "net", items: raw.items.map((i, index) => ({ ...i, amount: index ? "40.00" : "60.00" })),
    adjustment_treatment: { ...raw.adjustment_treatment, tax: "additional" } };
  const partial = { ...confirm(mixed, "simple"), items: chosen.items.map((i, index) => ({ ...i, amount: mixed.items[index].amount })) };
  assert.throws(() => core.calculateAllocation(mixed, partial), /could not verify/);
  const manual = core.calculateAllocation(mixed, { ...partial, claimed_amount: "66.00", override_reason: "Only selected goods are taxable." });
  assert.match(manual.automatic_issue, /mixed tax rates or tax-exempt/); assert.equal(manual.expected_amount, "66.00");
  // A client cannot erase mixed-tax evidence from the server-owned reading.
  assert.throws(() => core.calculateAllocation(mixed, { ...partial, mode: "auto", adjustment_treatment: { ...mixed.adjustment_treatment, tax_scope: "all_items", uniform: true } }), /mixed tax rates/);
  assert.equal(core.calculateAllocation(mixed, confirm(mixed, "simple")).expected_amount, "106.00");
});

test("Tax defaults keep discount and rounding uniformity checks, including signed sen rounding", () => {
  const raw = { ...reading, total: "106.00", tax: "6.00",
    items: [{ ...reading.items[0], amount: "60.00" }, { ...reading.items[1], amount: "40.00" }],
    adjustment_treatment: { tax: "additional", discount: "none", rounding: "none", uniform: false } };
  for (const [field, amount, total] of [["discount", "10.00", "96.00"], ["rounding", "-0.02", "105.98"]]) {
    const receipt = { ...raw, [field]: amount, total, adjustment_treatment: { ...raw.adjustment_treatment, [field]: "additional" } };
    const chosen = confirm(receipt); chosen.items[1].included = false; chosen.items[1].reason = "Personal";
    assert.throws(() => core.calculateAllocation(receipt, chosen), /uniformly/);
    const result = core.calculateAllocation(receipt, { ...chosen, adjustment_treatment: { ...chosen.adjustment_treatment, uniform: true } });
    assert.equal(result.expected_amount, field === "discount" ? "57.60" : "63.59");
  }
});
test("Mixed receipt excludes personal items and compares the claim to the selection, not the full total", () => {
  const calculation = core.calculateAllocation(reading, selection);
  assert.equal(calculation.expected_amount, "80.00");
  assert.equal(calculation.excluded_subtotal, "20.00");
  const plan = { extraction: reading, selection, calculation, revision: 2 };
  const extracted = { receipts: [{ readable: true, amount: "100.00", currency: "MYR", date: reading.date }], purpose_clear: true, purpose_note: "", warnings: [] };
  assert.equal(audit.compareClaim(extracted, "80.00", reading.date, plan).amount_status, "match");
  const inflated = audit.compareClaim(extracted, "85.00", reading.date, plan);
  assert.equal(inflated.amount_status, "mismatch");
  assert.equal(inflated.allocation.difference, "5.00");
  assert.ok(inflated.needs_attention);
});
test("Sen arithmetic reconciles discounts, tax and signed rounding without adding included tax twice", () => {
  const raw = structuredClone(reading);
  raw.line_amount_basis = "net"; raw.tax = "6.00"; raw.discount = "2.00"; raw.rounding = "-0.02"; raw.total = "103.98";
  const value = { ...selection, mode: "proportional", receipt_total: raw.total, adjustment_reason: "All goods have the same tax and discount basis." };
  const result = core.calculateAllocation(raw, value);
  assert.equal(result.tax, "4.80"); assert.equal(result.discount, "1.60"); assert.equal(result.rounding, "-0.02");
  assert.equal(result.expected_amount, "83.18");
  const gross = core.calculateAllocation({ ...reading, tax: "6.00" }, { ...selection, mode: "proportional", adjustment_reason: "Tax included uniformly." });
  assert.equal(gross.expected_amount, "80.00"); assert.equal(gross.tax, "0.00");
});
test("Unknown fields, tampered selections and unexplained overrides cannot silently produce an amount", () => {
  for (const bad of [
    { ...selection, confirmed: false }, { ...selection, confirmed: "false" }, { ...selection, items: [selection.items[0], selection.items[0], selection.items[2]] },
    { ...selection, items: selection.items.slice(1) }, { ...selection, receipt_total: "1e3" },
    { ...selection, items: selection.items.map(i => ({ ...i, reason: "" })) },
    { ...selection, items: selection.items.map(i => ({ ...i, amount: "900.00" })) },
    { ...selection, rounding: "1.01" }, { ...selection, tax: "200.00" },
    { ...selection, receipt_total: "105.00", correction_reason: "" },
  ]) assert.throws(() => core.calculateAllocation(reading, bad));
  assert.throws(() => core.calculateAllocation({ ...reading, currency: null }, selection), /MYR/);
  assert.throws(() => core.calculateAllocation({ ...reading, line_amount_basis: "unknown" }, { ...selection, mode: "proportional" }), /unclear/);
  const corrected = core.calculateAllocation(reading, { ...selection, items: selection.items.map(i => i.id === "1" ? { ...i, amount: "25.00" } : i), correction_reason: "The AI read the discount as part of the line total." });
  assert.equal(corrected.expected_amount, "75.00"); assert.ok(corrected.issues.some(i => i.includes("corrected")));
});
test("Receipt type warnings remain advisory, and uncertain items require a purpose", () => {
  const result = core.calculateAllocation({ ...reading, document_type: "quotation", payment_status: "unknown" }, selection);
  assert.ok(result.issues.some(s => s.includes("quotation")));
  const included = { ...selection, items: selection.items.map(i => ({ ...i, included: true, reason: "" })) };
  assert.throws(() => core.calculateAllocation(reading, included), /purpose/);
});
test("Extraction validation rejects invalid dates, duplicate lines and hallucinated numeric formats", () => {
  assert.equal(core.validateReceiptExtraction({ ...reading, injected: "DROP TABLE" }).injected, undefined);
  for (const invalid of [{ ...reading, date: "2026-02-30" }, { ...reading, total: "NaN" }, { ...reading, tax: "-2.00" },
    { ...reading, adjustment_treatment: { tax: "additional", discount: "none", rounding: "none", uniform: false, tax_scope: "invalid" } },
    { ...reading, items: [reading.items[0], reading.items[0]] }, { ...reading, document_type: "definitely_authentic" }]) assert.throws(() => core.validateReceiptExtraction(invalid));
});
test("Changing item-plan revision invalidates the existing AI check signature", () => {
  const claim = { amount: "80", purchase_date: reading.date, category: "Materials", description: "Workshop", activity_id: "a" };
  assert.notEqual(audit.checkSignature(claim, [], 1), audit.checkSignature(claim, [], 2));
});
test("Receipt reader sends actual image data and rejects incomplete or malformed structured results", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async (_, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
      assert.match(body.systemInstruction.parts[0].text, /untrusted DATA/);
      assert.ok(body.generationConfig.responseSchema.properties.items);
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(reading) }] } }] });
    };
    assert.equal((await reader.readReceiptDraft("test", "test", { mime: "image/png", bytes: Buffer.from("test") }, { name: "Workshop" })).items.length, 3);
    for (const response of [new Response("", { status: 429 }), Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }), Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(reader.readReceiptDraft("test", "test", { mime: "image/png", bytes: Buffer.from("test") }, { name: "Workshop" }, undefined, async () => {}));
    }
  } finally { globalThis.fetch = saved; }
});
test("Temporary Gemini overload is retried and a later successful reading is returned", async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  const waits = [];
  try {
    globalThis.fetch = async () => ++attempts < 3
      ? Response.json({ error: { status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }, { status: 503 })
      : Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(reading) }] } }] });
    const result = await reader.readReceiptDraft("private-api-key", "test-model", { mime: "image/png", bytes: Buffer.from("test") }, { name: "Workshop" }, undefined, async ms => { waits.push(ms); });
    assert.equal(result.total, "100.00"); assert.equal(attempts, 3); assert.equal(waits.length, 2);
    assert.ok(waits[1] > waits[0]);
  } finally { globalThis.fetch = original; }
});
test("Persistent overload, access rejection and bad request settings remain distinct and never expose credentials", async () => {
  const original = globalThis.fetch;
  try {
    for (const [http, status, expectedAttempts, message] of [[503, "UNAVAILABLE", 3, /temporarily busy/], [403, "PERMISSION_DENIED", 1, /access was denied/], [400, "INVALID_ARGUMENT", 1, /rejected the receipt-reading request/]]) {
      let attempts = 0;
      globalThis.fetch = async () => { attempts++; return Response.json({ error: { status, message: "Schema request rejected, credential private-api-key https://example.invalid/?key=private-api-key" } }, { status: http }); };
      await assert.rejects(reader.readReceiptDraft("private-api-key", "test-model", { mime: "image/png", bytes: Buffer.from("test") }, { name: "Workshop" }, undefined, async () => {}), e => {
        assert.equal(e.name, "ReceiptAiError"); assert.match(e.message, message);
        assert.equal(e.httpStatus, http === 503 ? 503 : 502);
        assert.equal(e.diagnostic.attempts, expectedAttempts);
        assert.equal(JSON.stringify(e).includes("private-api-key"), false);
        return true;
      });
      assert.equal(attempts, expectedAttempts);
    }
  } finally { globalThis.fetch = original; }
});
export { core, load };
