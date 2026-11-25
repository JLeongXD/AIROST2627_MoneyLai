import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import { reading, selection } from "./fixtures/receipt.mjs";
const require = createRequire(import.meta.url);
async function load(file, imports = {}) {
  const m = new Module(path.resolve(file)); m.filename = path.resolve(file); m.paths = require.resolve.paths("typescript");
  m.require = name => Object.hasOwn(imports, name) ? imports[name] : require(name);
  m._compile(ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, m.filename);
  return m.exports;
}
const core = await load("src/lib/ai/receipt-allocation.ts");
const audit = await load("src/lib/ai/claim-check.ts");
const reader = await load("src/lib/ai/receipt-reader.ts", { "server-only": {}, "./receipt-allocation": core });
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
