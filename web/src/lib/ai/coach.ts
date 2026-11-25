import type { CheckResult } from "./claim-check";

export function coachFindings(report: CheckResult, claimedAmount: string) {
  const findings: { title: string; evidence: string; next: string; action: "edit" | "upload" | "review" }[] = [];
  if (report.amount_status !== "match") findings.push({
    title: report.amount_status === "mismatch" ? "Confirm the claim amount" : "Amount could not be verified",
    evidence: `Claimed: RM ${claimedAmount}. Readable MYR receipt total: ${report.receipt_total === null ? "unknown" : `RM ${report.receipt_total}`}.`,
    next: "Check the amount and eligible purchases. Correct the draft or attach missing receipts; do not change a correct claim just to match AI.",
    action: report.amount_status === "mismatch" ? "edit" : "upload",
  });
  if (report.date_status !== "match") findings.push({ title: "Check the purchase date", evidence: report.date_status === "mismatch" ? "Receipt dates differ from the claim date." : "At least one receipt date is missing or unreadable.", next: "Confirm the date in your draft or upload a complete, clearer receipt showing its date.", action: "edit" });
  if (!report.purpose_clear) findings.push({ title: "Explain the club purpose", evidence: report.purpose_note, next: "Describe what was bought and how it was used for this activity. Include only facts you can confirm.", action: "edit" });
  for (const receipt of report.receipts.filter((r) => !r.readable)) findings.push({ title: "Upload a clearer receipt", evidence: receipt.note || "The receipt could not be read reliably.", next: "Photograph the full receipt in good light, including the total and date. Use one receipt per file.", action: "upload" });
  for (const warning of report.warnings) findings.push({ title: "Review this finding", evidence: warning, next: "Check the original document and clarify the issue for the Treasurer.", action: "review" });
  return findings;
}
