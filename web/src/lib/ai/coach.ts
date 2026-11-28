import type { CheckResult } from "./claim-check";
import type { ReceiptPlan } from "./receipt-allocation";

export function coachFindings(report: CheckResult, claimedAmount: string | null, plan?: ReceiptPlan | null) {
  const findings: { title: string; evidence: string; next: string; action: "edit" | "upload" | "review" }[] = [];
  const claimed = claimedAmount === null ? "unavailable for this previous check" : `RM ${claimedAmount}`;
  if (report.amount_status !== "match") findings.push({
    title: report.amount_status === "mismatch" ? "Confirm the claim amount" : "Amount could not be verified",
    evidence: report.allocation ? `Claimed: ${claimed}. Receipt comparison amount: RM ${report.allocation.expected_amount}. Difference: RM ${report.allocation.difference}.` : `Claimed: ${claimed}. Readable MYR receipt total: ${report.receipt_total === null ? "unknown" : `RM ${report.receipt_total}`}.`,
    next: "Check the amount and eligible purchases. Correct the draft or attach missing receipts; do not change a correct claim just to match AI.",
    action: report.amount_status === "mismatch" ? "edit" : "upload",
  });
  if (report.date_status !== "match") findings.push({ title: "Check the purchase date", evidence: report.date_status === "mismatch" ? "Receipt dates differ from the claim date." : "At least one receipt date is missing or unreadable.", next: "Confirm the date in your draft or upload a complete, clearer receipt showing its date.", action: "edit" });
  if (!report.purpose_clear) findings.push({ title: "Explain the club purpose", evidence: report.purpose_note, next: "Describe what was bought and how it was used for this activity. Include only facts you can confirm.", action: "edit" });
  for (const receipt of report.receipts.filter((r) => !r.readable)) findings.push({ title: "Upload a clearer receipt", evidence: receipt.note || "The receipt could not be read reliably.", next: "Photograph the full receipt in good light, including the total and date. Use one receipt per file.", action: "upload" });
  for (const warning of new Set(report.warnings)) {
    if (warning.startsWith("Fresh AI item readings differ")) findings.push({
      title: "Check receipt items",
      evidence: "The latest AI item reading differs from the saved details. This alone is not evidence of misuse.",
      next: "Compare the original receipt with the saved items and correction notes. AI did not identify the specific fields that changed.", action: "review",
    });
    else if (warning.startsWith("Fresh AI reading differs from the saved original total")) findings.push({
      title: "Check the receipt total", evidence: "The latest AI total differs from the saved original total.",
      next: "Compare the original receipt total with the saved total and any correction notes.", action: "review",
    });
    else if (/^Document: [a-z_]+; payment: [a-z_]+\. Verify payment evidence\.$/.test(warning)) {
      const [, documentType, payment] = warning.match(/^Document: ([a-z_]+); payment: ([a-z_]+)/)!;
      findings.push({ title: "Check payment evidence", evidence: `AI identified the document as ${documentType.replaceAll("_", " ")}; payment status: ${payment}.`,
        next: "Check that the original document or an attachment shows payment was made.", action: "review" });
    } else if (warning === "Member declared all purchases for the activity; review flagged item purposes.") {
      const items = plan?.extraction.items.filter(item => item.relevance === "needs_confirmation");
      findings.push({ title: "Explain activity use",
        evidence: items?.length ? `You declared all purchases were for this activity. Saved items needing clarification: ${items.map(item => `${item.description}${item.reason ? ` (${item.reason})` : ""}`).join("; ")}.` : "You declared all purchases were for this activity, but AI flagged their purpose without identifying specific items.",
        next: "Confirm how these purchases were used for the activity and add an explanation where needed.", action: "review" });
    } else findings.push({ title: "Check this receipt detail", evidence: warning, next: "Check this detail against the original receipt and add an explanation for the Treasurer if needed.", action: "review" });
  }
  return findings;
}

export function reviewFindingGroups(findings: ReturnType<typeof coachFindings>) {
  const groups = new Map<string, { title: string; findings: typeof findings }>();
  for (const finding of findings) {
    const title = /purpose|activity use/i.test(finding.title) ? "Clarify activity purpose"
      : /payment|clearer receipt/i.test(finding.title) || (finding.title === "Check this receipt detail" && /payment|invoice|document|readab/i.test(finding.evidence)) ? "Check payment evidence"
      : /amount|receipt total/i.test(finding.title) ? "Check the amount"
      : /date/i.test(finding.title) ? "Check the purchase date"
      : /receipt items/i.test(finding.title) ? "Check receipt items" : "Check other receipt details";
    if (!groups.has(title)) groups.set(title, { title, findings: [] });
    const group = groups.get(title)!;
    if (!group.findings.some(f => f.evidence === finding.evidence && f.next === finding.next)) group.findings.push(finding);
  }
  return [...groups.values()];
}
