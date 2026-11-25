import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire, Module } from "node:module";
import path from "node:path";
import ts from "typescript";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFDocument, PDFName } from "pdf-lib";
import { reading, selection } from "./fixtures/receipt.mjs";
const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/lib/reports/activity-pack.ts", import.meta.url), "utf8");
const compiled = new Module(path.resolve("src/lib/reports/activity-pack.ts"));
compiled.filename = path.resolve("src/lib/reports/activity-pack.ts");
compiled.paths = require.resolve.paths("exceljs");
compiled._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, compiled.filename);
const { buildActivityPack, ExportLimitError } = compiled.exports;
const snapshot = {
  generated_at: "2026-11-25T12:00:00Z", scope: "treasurer_evidence",
  activity: { id: "activity-id", name: "机器人工作坊 / Robotics", description: "活动财务报告\nWorkshop accountability report", budget: 1000, remaining_budget: 800, unpaid_amount: 80, paid_amount: 120, pending_amount: 30, status: "closed", event_date: "2026-11-25" },
  claims: [
    { id: "claim-one", code: "ML-000001", claimant_name: "李小明", amount: 120, description: "购买机器人零件\n" + "A detailed purchase description with words and spaces. ".repeat(30), status: "paid", submitted_at: "2026-11-24T10:00:00Z", category: "Materials", purchase_date: "2026-11-24" },
    { id: "claim-two", code: "ML-000002", claimant_name: "A student", amount: "80.00", description: "=HYPERLINK(\"https://invalid.example\")", status: "approved", submitted_at: null, category: "Equipment", purchase_date: null },
    { id: "claim-draft", code: "ML-000003", status: "draft" },
  ],
  attachments: [
    { claim_id: "claim-one", kind: "receipt", storage_path: "private/receipt.pdf", original_name: "收据.pdf", mime_type: "application/pdf", size_bytes: 100 },
    { claim_id: "claim-one", kind: "supporting", storage_path: "private/damaged.pdf", original_name: "../../bad.pdf", mime_type: "application/pdf", size_bytes: 100 },
    { claim_id: "claim-two", kind: "supporting", storage_path: "private/missing.png", original_name: "missing.png", mime_type: "image/png", size_bytes: 100 },
  ],
  payments: [{ claim_id: "claim-one", paid_on: "2026-11-25", reference: "PRIVATE_TRANSFER_REF", proof_path: "private/proof.png", amount: 120, recipient_snapshot: { account_number: "SECRET_ACCOUNT" } }],
  events: [{ claim_id: "claim-one", event_type: "approved", note: "PRIVATE_AUDIT_NOTE", actor: "Treasurer", created_at: "2026-11-25T11:00:00Z", snapshot: { secret: "SECRET_SNAPSHOT" } }],
  activity_events: [{ old_budget: 0, new_budget: 1000, note: "Approved budget", actor: "President", created_at: "2026-11-23T11:00:00Z" }],
  receipt_plans: [{ claim_id: "claim-two", session_id: "session", revision: 1, original_name: "收据.png", sha256: "a".repeat(64), model: "test-model", extraction: reading, selection,
    calculation: { receipt_total: "100.00", raw_receipt_total: "100.00", selected_subtotal: "80.00", excluded_subtotal: "20.00", tax: "0.00", discount: "0.00", rounding: "0.00", expected_amount: "80.00", method: "manual", adjustment_reason: "Tax included", correction_reason: "", issues: [] } }],
  receipt_plan_history: [],
};
const receipt = await PDFDocument.create();
receipt.addPage().drawText("RECEIPT RM120");
const receiptBytes = await receipt.save();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
test("Treasurer ZIP links claims, includes originals and flags missing or damaged evidence", async () => {
  const pack = await buildActivityPack(snapshot, async (_, p) => {
    if (p.endsWith("receipt.pdf")) return receiptBytes;
    if (p.endsWith("proof.png")) return png;
    if (p.endsWith("damaged.pdf")) return Buffer.from("not a PDF");
    throw new Error("not found");
  });
  const zip = await JSZip.loadAsync(pack.bytes);
  assert.ok(zip.file("activity-report.pdf"));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.claims.length, 2);
  assert.ok(manifest.evidence.some(e => /No receipt/.test(e.issue ?? "")));
  assert.ok(manifest.evidence.some(e => /could not be downloaded/.test(e.issue ?? "")));
  const broken = manifest.evidence.find(e => e.name === "../../bad.pdf");
  assert.match(broken.issue, /Original retained/);
  assert.ok(zip.file(broken.archive_path));
  assert.ok(!Object.keys(zip.files).some(n => n.includes("../")));
  assert.ok(manifest.evidence.some(e => e.kind === "payment proof" && e.included_in_pdf));
  assert.equal(JSON.stringify(manifest).includes("private/"), false);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await zip.file("activity-ledger.xlsx").async("nodebuffer"));
  const ledger = workbook.getWorksheet("Claims");
  assert.equal(ledger.getCell("C2").value, "李小明");
  assert.equal(ledger.getCell("I2").value, 120);
  assert.equal(typeof ledger.getCell("G3").value, "string"); // User input stays literal, not an Excel formula.
  assert.match(ledger.getCell("J2").value.hyperlink, /activity-report.pdf#page=\d+/);
  assert.ok(workbook.getWorksheet("Evidence completeness"));
  assert.equal(workbook.getWorksheet("Receipt calculations").getCell("I2").value, 80);
  assert.ok(workbook.getWorksheet("Receipt item selection"));
  assert.equal(JSON.parse(await zip.file("receipt-selections.json").async("string")).plans[0].selection.items[2].included, false);
  assert.equal(JSON.stringify(workbook.model).includes("SECRET_ACCOUNT"), false);
  assert.equal(JSON.stringify(workbook.model).includes("SECRET_SNAPSHOT"), false);
  const pdf = await PDFDocument.load(await zip.file("activity-report.pdf").async("uint8array"));
  assert.ok(pdf.getPages().some(p => p.node.get(PDFName.of("Annots"))));
  assert.ok(pdf.getPageCount() >= 7);
  if (process.env.MONEYLAI_EXPORT_QA_DIR) {
    await mkdir(process.env.MONEYLAI_EXPORT_QA_DIR, { recursive: true });
    await writeFile(path.join(process.env.MONEYLAI_EXPORT_QA_DIR, "report.pdf"), await zip.file("activity-report.pdf").async("nodebuffer"));
  }
});
test("President summary ignores accidentally supplied private evidence and never downloads it", async () => {
  const pack = await buildActivityPack({ ...snapshot, scope: "president_summary" }, () => { throw new Error("Must not download"); });
  const zip = await JSZip.loadAsync(pack.bytes);
  assert.equal(Object.keys(zip.files).some(n => n.startsWith("evidence/")), false);
  assert.equal(zip.file("receipt-selections.json"), null);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await zip.file("activity-ledger.xlsx").async("nodebuffer"));
  assert.deepEqual(workbook.worksheets.map(s => s.name), ["Summary", "Claims"]);
  assert.equal(JSON.stringify(workbook.model).includes("PRIVATE_"), false);
  assert.deepEqual(JSON.parse(await zip.file("manifest.json").async("string")).evidence, []);
});
test("Export rejects oversized activity or evidence lists before downloading", async () => {
  const never = () => { throw new Error("Must not download"); };
  await assert.rejects(buildActivityPack({ ...snapshot, claims: Array(1001).fill(snapshot.claims[0]) }, never), ExportLimitError);
  await assert.rejects(buildActivityPack({ ...snapshot, attachments: Array(201).fill(snapshot.attachments[0]) }, never), ExportLimitError);
});
