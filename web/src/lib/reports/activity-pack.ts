import ExcelJS from "exceljs";
import JSZip from "jszip";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Activity, Money } from "../types";

type ExportClaim = {
  id: string; code: string; claimant_name: string; amount: Money; description: string;
  status: string; submitted_at: string | null; category: string; purchase_date: string | null;
};
type ExportAttachment = {
  claim_id: string; kind: string; storage_path: string; original_name: string;
  mime_type: string; size_bytes: number;
};
type ExportPayment = { claim_id: string; paid_on: string; reference: string; amount: Money; proof_path: string };
type ExportEvent = { claim_id: string; event_type: string; note: string | null; created_at: string; actor: string };
export type ActivityExportSnapshot = {
  generated_at: string; scope: "treasurer_evidence" | "president_summary"; activity: Activity;
  claims: ExportClaim[]; attachments: ExportAttachment[]; payments: ExportPayment[]; events: ExportEvent[];
  activity_events: { old_budget: Money | null; new_budget: Money; note: string; created_at: string; actor: string }[];
};
type Evidence = {
  claimId: string; claimCode: string; name: string; kind: string; bucket: string; source: string;
  mime: string; archivePath: string; bytes?: Uint8Array; embedded: boolean; issue: string | null;
};
export const EXPORT_LIMITS = { claims: 1000, files: 200, fileBytes: 5 * 1024 ** 2, rawBytes: 50 * 1024 ** 2, zipBytes: 60 * 1024 ** 2 };
export class ExportLimitError extends Error {}
export function safeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^\.+|[. ]+$/g, "").slice(0, 120) || "activity";
}
const amount = (n: Money) => `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stamp = (s: string | null) => s ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(s)) : "-";
const statusLabel: Record<string, string> = { submitted: "Pending review", needs_info: "Needs information", approved: "Awaiting payment", paid: "Reimbursed", rejected: "Rejected", cancelled: "Cancelled (historical)" };

export async function buildActivityPack(
  snapshot: ActivityExportSnapshot,
  download: (bucket: string, storagePath: string) => Promise<Uint8Array>,
) {
  // Whitelist the report fields. A summary export must never fetch or serialize evidence.
  const fiscal = snapshot.scope === "treasurer_evidence";
  const claims = snapshot.claims.filter(c => c.status !== "draft");
  if (claims.length > EXPORT_LIMITS.claims) throw new ExportLimitError("Export limit: 1000 claims per activity.");
  const ids = new Set(claims.map(c => c.id));
  const payments = fiscal ? snapshot.payments.filter(p => ids.has(p.claim_id)) : [];
  const events = fiscal ? snapshot.events.filter(e => ids.has(e.claim_id)) : [];
  const activityEvents = fiscal ? snapshot.activity_events : [];
  const evidence: Evidence[] = [];
  for (const claim of claims) {
    if (!fiscal) continue;
    const files = snapshot.attachments.filter(a => a.claim_id === claim.id);
    for (const file of files) {
      evidence.push({ claimId: claim.id, claimCode: claim.code, name: file.original_name, kind: file.kind,
        bucket: "receipts", source: file.storage_path, mime: file.mime_type,
        archivePath: `evidence/${safeFilename(claim.code)}/${evidence.length + 1}-${safeFilename(file.original_name)}`,
        embedded: false, issue: file.size_bytes > EXPORT_LIMITS.fileBytes ? "File exceeds the 5 MB evidence limit." : null });
    }
    if (!files.some(a => a.kind === "receipt") && claim.status !== "cancelled") {
      evidence.push({ claimId: claim.id, claimCode: claim.code, name: "Missing receipt", kind: "receipt",
        bucket: "", source: "", mime: "", archivePath: "", embedded: false, issue: "No receipt registered for this claim." });
    }
    const payment = payments.find(p => p.claim_id === claim.id);
    if (payment?.proof_path) {
      const ext = payment.proof_path.split(".").pop()?.toLowerCase();
      const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ["jpg", "jpeg"].includes(ext ?? "") ? "image/jpeg" : "application/octet-stream";
      evidence.push({ claimId: claim.id, claimCode: claim.code, name: `Payment proof.${safeFilename(ext ?? "bin")}`,
        kind: "payment proof", bucket: "payment-proofs", source: payment.proof_path, mime,
        archivePath: `evidence/${safeFilename(claim.code)}/payment-proof.${["pdf", "png", "jpg", "jpeg"].includes(ext ?? "") ? ext : "bin"}`,
        embedded: false, issue: null });
    } else if (claim.status === "paid") {
      evidence.push({ claimId: claim.id, claimCode: claim.code, name: "Missing payment proof", kind: "payment proof",
        bucket: "", source: "", mime: "", archivePath: "", embedded: false, issue: "No payment record or proof registered for a reimbursed claim." });
    }
  }
  if (evidence.filter(e => e.source).length > EXPORT_LIMITS.files) throw new ExportLimitError("Export limit: 200 evidence files per activity.");
  let rawBytes = 0;
  const zip = new JSZip();
  for (const item of evidence) {
    if (!item.source || item.issue) continue;
    try {
      const bytes = await download(item.bucket, item.source);
      if (!bytes.length || bytes.length > EXPORT_LIMITS.fileBytes) {
        item.issue = "Evidence is empty or exceeds the 5 MB file limit.";
        continue;
      }
      rawBytes += bytes.length;
      if (rawBytes > EXPORT_LIMITS.rawBytes) throw new ExportLimitError("Export limit: 50 MB of original evidence. Split this activity before exporting.");
      item.bytes = bytes;
      zip.file(item.archivePath, bytes);
    } catch (error) {
      if (error instanceof ExportLimitError) throw error;
      item.issue = "Original file could not be downloaded. Check the claim and export again.";
    }
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${snapshot.activity.name} - Activity accountability pack`);
  pdf.setAuthor("MoneyLai");
  pdf.registerFontkit(fontkit);
  const latin = await pdf.embedFont(StandardFonts.Helvetica);
  // Full font embedding avoids missing CJK glyphs in fontkit's subset output.
  const cjk = await pdf.embedFont(await readFile(path.join(process.cwd(), "public/fonts/NotoSansSC-Regular.ttf")), { subset: false });
  const ink = rgb(0.07, 0.18, 0.16), muted = rgb(0.32, 0.4, 0.38);
  const clean = (v: unknown) => String(v ?? "-").replace(/[^\P{Cc}\n\r\t]/gu, "").replace(/\t/g, " ");
  const runs = (s: string) => s.match(/[\x20-\x7e]+|[^\x20-\x7e]+/g) ?? [];
  const fontFor = (s: string) => /^[\x20-\x7e]+$/.test(s) ? latin : cjk;
  const width = (s: string, size: number) => runs(s).reduce((w, r) => w + fontFor(r).widthOfTextAtSize(r, size), 0);
  function draw(p: PDFPage, value: unknown, x: number, y: number, size = 11, color = ink) {
    for (const run of runs(clean(value))) {
      const font = fontFor(run);
      p.drawText(run, { x, y, size, font, color });
      x += font.widthOfTextAtSize(run, size);
    }
  }
  function shorten(s: string, size: number, max: number) {
    let out = clean(s).replace(/[\n\r]/g, " ");
    if (width(out, size) <= max) return out;
    while (out && width(out + "...", size) > max) out = out.slice(0, -1);
    return out + "...";
  }
  let page: PDFPage;
  let y = 770;
  function newPage(title: string) {
    page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 790, width: 595.28, height: 52, color: rgb(0.93, 0.96, 0.94) });
    draw(page, shorten(title, 13, 510), 42, 810, 13);
    y = 766;
    return page;
  }
  function text(value: unknown, size = 11) {
    const lineHeight = size * 1.5;
    for (const paragraph of clean(value).split(/\r?\n/)) {
      let line = "";
      const flush = () => { if (y < 55) newPage(`${snapshot.activity.name} - continued`); draw(page, line, 42, y, size); y -= lineHeight; line = ""; };
      for (const char of paragraph) {
        if (line && width(line + char, size) > 510) {
          const space = line.lastIndexOf(" ");
          if (space > line.length / 2) {
            const rest = line.slice(space + 1); line = line.slice(0, space); flush(); line = rest;
          } else flush();
        }
        line += char;
      }
      flush();
    }
    y -= 5;
  }
  const a = snapshot.activity;
  const metrics: [string, Money][] = [["Allocated budget", a.budget], ["Approved, awaiting payment", a.unpaid_amount],
    ["Reimbursed", a.paid_amount], ["Available budget", a.remaining_budget], ["Pending review (not reserved)", a.pending_amount]];
  newPage("MoneyLai / Activity accountability pack");
  text(a.name, 21);
  text(a.description || "No activity description.");
  text(`Event: ${a.event_date || "Not specified"} | Status: ${a.status}`);
  text(`Generated: ${stamp(snapshot.generated_at)} (Asia/Kuala_Lumpur)`);
  text(fiscal ? "Treasurer evidence pack - contains private financial evidence. Share only with authorized reviewers." : "President summary pack - excludes receipts, payment proof, transfer references and audit conversations.");
  y -= 10;
  for (const [label, value] of metrics) text(`${label}: ${amount(value)}`, 13);
  text("Available = allocated - approved claims awaiting payment - reimbursed claims. Pending and needs-information claims do not reserve budget.");
  text(`${claims.length} non-draft claims. Drafts are excluded. This is a point-in-time record, not independent certification or a digital signature.`);
  const summaryWarningY = y;
  const summaryPage = page!;
  const tocPages: PDFPage[] = [];
  for (let i = 0; i < Math.ceil(claims.length / 24); i++) tocPages.push(newPage("Claim directory / click a claim to open"));
  const claimPages = new Map<string, number>();
  let embeddedPages = 0;
  for (const claim of claims) {
    newPage(`${claim.code} / ${claim.claimant_name}`);
    claimPages.set(claim.id, pdf.getPageCount());
    text(`${claim.code} - ${statusLabel[claim.status] ?? claim.status}`, 17);
    text(`Claim ID: ${claim.id}`, 9);
    text(`Claimant: ${claim.claimant_name}`);
    text(`Amount: ${amount(claim.amount)} | Category: ${claim.category}`);
    text(`Purchase date: ${claim.purchase_date ?? "-"} | Submitted: ${stamp(claim.submitted_at)}`);
    text(claim.description);
    if (!fiscal) continue;
    const payment = payments.find(p => p.claim_id === claim.id);
    if (payment) text(`Reimbursement: ${amount(payment.amount)} on ${payment.paid_on}\nTransfer reference: ${payment.reference}`);
    for (const e of events.filter(e => e.claim_id === claim.id)) text(`${stamp(e.created_at)} | ${e.actor} | ${e.event_type}\n${e.note ?? "-"}`, 10);
    for (const item of evidence.filter(e => e.claimId === claim.id)) {
      if (item.bytes) {
        try {
          if (item.mime === "application/pdf") {
            const original = await PDFDocument.load(item.bytes);
            if (original.getPageCount() > 60 || embeddedPages + original.getPageCount() > 1000) throw new Error("page limit");
            // Embed sequentially so a failed page is recorded without losing the original.
            for (let i = 0; i < original.getPageCount(); i++) {
              const embedded = await pdf.embedPage(original.getPage(i));
              const target = newPage(`${claim.code} / ${item.kind} / ${i + 1}`);
              draw(target, shorten(item.name, 10, 510), 42, 770, 10, muted);
              const scale = Math.min(510 / embedded.width, 690 / embedded.height);
              target.drawPage(embedded, { x: 42 + (510 - embedded.width * scale) / 2, y: 55, width: embedded.width * scale, height: embedded.height * scale });
              embeddedPages++;
            }
          } else if (["image/png", "image/jpeg"].includes(item.mime)) {
            if (embeddedPages >= 1000) throw new Error("page limit");
            const image = item.mime === "image/png" ? await pdf.embedPng(item.bytes) : await pdf.embedJpg(item.bytes);
            const target = newPage(`${claim.code} / ${item.kind}`);
            draw(target, shorten(item.name, 10, 510), 42, 770, 10, muted);
            const scale = Math.min(510 / image.width, 690 / image.height);
            target.drawImage(image, { x: 42 + (510 - image.width * scale) / 2, y: 55, width: image.width * scale, height: image.height * scale });
            embeddedPages++;
          } else throw new Error("unsupported type");
          item.embedded = true;
        } catch {
          item.issue = "Could not fully include in the PDF (unsupported, encrypted, damaged or page limit). Original retained in the ZIP.";
        }
      }
      if (item.issue) { newPage(`${claim.code} / Evidence attention needed`); text(item.name, 15); text(item.issue); }
    }
  }
  const issues = evidence.filter(e => e.issue).length;
  if (fiscal) draw(summaryPage, `${issues} evidence issue(s). See evidence-completeness sheet and manifest.json.`, 42, summaryWarningY, 10, muted);
  claims.forEach((claim, i) => {
    const target = pdf.getPage(claimPages.get(claim.id)! - 1);
    const toc = tocPages[Math.floor(i / 24)];
    const yy = 760 - (i % 24) * 28;
    draw(toc, shorten(`${claim.code} | ${claim.claimant_name} | ${amount(claim.amount)}`, 11, 455), 42, yy);
    draw(toc, String(claimPages.get(claim.id)), 525, yy);
    toc.node.addAnnot(pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [40, yy - 4, 553, yy + 15], Border: [0, 0, 0], A: { S: "GoTo", D: [target.ref, "Fit"] } })));
  });
  pdf.getPages().forEach((p, i) => draw(p, `MoneyLai | ${i + 1} / ${pdf.getPageCount()} | ${stamp(snapshot.generated_at)} MYT`, 42, 23, 8, muted));
  zip.file("activity-report.pdf", await pdf.save());

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MoneyLai";
  workbook.created = new Date(snapshot.generated_at);
  function sheet(name: string, headers: string[], rows: ExcelJS.CellValue[][]) {
    const s = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    s.addRow(headers); s.addRows(rows);
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123D34" } };
    s.columns.forEach((c, i) => { c.width = i === 0 ? 24 : 30; });
    s.eachRow(r => { r.alignment = { vertical: "top", wrapText: true }; });
    s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    return s;
  }
  sheet("Summary", ["Item", "Value"], [
    ["Activity", a.name], ["Description", a.description ?? ""], ["Event date", a.event_date ?? ""], ["Status", a.status],
    ["Generated (MYT)", stamp(snapshot.generated_at)], ["Scope", fiscal ? "Treasurer evidence" : "President summary"],
    ...metrics.map(([label, value]): ExcelJS.CellValue[] => [label, Number(value)]),
    ["Budget calculation", "Allocated - approved awaiting payment - reimbursed. Pending/needs-info do not reserve budget."],
    ["Claims", claims.length], ["Drafts", "Excluded"], ["Evidence issues", fiscal ? issues : "Excluded from summary scope"],
    ["Important", "Snapshot only; not independent certification or a digital signature."],
  ]);
  const ledger = sheet("Claims", ["Claim code", "Claim UUID", "Claimant", "Category", "Purchase date", "Submitted (MYT)", "Description", "Status", "Amount (RM)", "PDF link"],
    claims.map(c => [c.code, c.id, c.claimant_name, c.category, c.purchase_date ?? "", stamp(c.submitted_at), c.description,
      statusLabel[c.status] ?? c.status, Number(c.amount), { text: `Page ${claimPages.get(c.id)}`, hyperlink: `activity-report.pdf#page=${claimPages.get(c.id)}` }]));
  ledger.getColumn(9).numFmt = '#,##0.00';
  if (fiscal) {
    const codes = new Map(claims.map(c => [c.id, c.code]));
    const paid = sheet("Reimbursements", ["Claim code", "Paid on", "Transfer reference", "Amount (RM)"], payments.map(p => [codes.get(p.claim_id)!, p.paid_on, p.reference, Number(p.amount)]));
    paid.getColumn(4).numFmt = '#,##0.00';
    sheet("Audit history", ["Claim code", "Time (MYT)", "Actor", "Event", "Note"], events.map(e => [codes.get(e.claim_id)!, stamp(e.created_at), e.actor, e.event_type, e.note ?? ""]));
    sheet("Budget history", ["Time (MYT)", "Actor", "Old budget (RM)", "New budget (RM)", "Note"], activityEvents.map(e => [stamp(e.created_at), e.actor, e.old_budget === null ? "" : Number(e.old_budget), Number(e.new_budget), e.note]));
    sheet("Evidence completeness", ["Claim code", "Kind", "Original name", "Original in ZIP", "Included in PDF", "Issue"], evidence.map(e => [e.claimCode, e.kind, e.name, e.bytes ? e.archivePath : "No", e.embedded ? "Yes" : "No", e.issue ?? ""]));
  }
  zip.file("activity-ledger.xlsx", await workbook.xlsx.writeBuffer());
  zip.file("manifest.json", JSON.stringify({
    format: "moneylai-activity-pack-v1", activity_id: a.id, activity_name: a.name, generated_at: snapshot.generated_at,
    scope: fiscal ? "treasurer_evidence" : "president_summary", drafts_excluded: true,
    claims: claims.map(c => ({ id: c.id, code: c.code, pdf_page: claimPages.get(c.id) })),
    evidence: evidence.map(e => ({ claim_id: e.claimId, claim_code: e.claimCode, name: e.name, kind: e.kind,
      archive_path: e.bytes ? e.archivePath : null, included_in_pdf: e.embedded, issue: e.issue })),
  }, null, 2));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (bytes.length > EXPORT_LIMITS.zipBytes) throw new ExportLimitError("Generated ZIP exceeds the 60 MB export limit.");
  return { bytes, filename: `${safeFilename(a.name)}-${fiscal ? "activity" : "summary"}-pack.zip`, issues };
}
