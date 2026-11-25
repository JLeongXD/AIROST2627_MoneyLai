import type { ClaimStatus } from "./types";
export type ActionKind = "saved" | "uploaded" | "submitted" | "requested" | "replied" | "approved" | "rejected" | "paid" | "removed" | "withdrawn" | "revised" | "deleted" | "updated";
export function feedbackFor(kind: ActionKind, id: string) {
  const claim = `/claims/${id}`;
  const messages = {
    saved: { title: "Draft saved", description: "Next: add a receipt, review your details and submit when ready.", href: `${claim}?flow=receipt`, label: "Continue with receipts", pending: "Saving draft…" },
    uploaded: { title: "File uploaded", description: "Next: check your receipt and expense details, then submit for review.", href: `${claim}?flow=review`, label: "Review & submit", pending: "Uploading file…" },
    submitted: { title: "Claim submitted", description: "Your Treasurer will review it. Follow its progress in My claims.", href: "/claims", label: "View my claims", pending: "Submitting claim…" },
    requested: { title: "Information request sent", description: "The claimant needs to update the draft and reply. You can continue reviewing other claims.", href: "/treasury", label: "Review another claim", pending: "Sending information request…" },
    replied: { title: "Reply sent and claim resubmitted", description: "Your changes are back with Treasurer for review. Your reply is saved in the claim history.", href: "/claims", label: "View my claims", pending: "Sending reply & resubmitting…" },
    approved: { title: "Claim approved", description: "Budget is reserved. Next: complete the external transfer, then record its payment proof.", href: claim, label: "Continue to reimbursement", pending: "Approving claim…" },
    rejected: { title: "Claim rejected with your reason", description: "The claimant can revise it. You can continue with the review queue.", href: "/treasury", label: "Review another claim", pending: "Recording rejection…" },
    paid: { title: "Reimbursement recorded", description: "This claim is complete. The claimant can now view the payment record.", href: "/treasury", label: "Return to review desk", pending: "Saving reimbursement record…" },
    removed: { title: "Attachment removed", description: "Add a replacement receipt if needed. At least one receipt is required before submission.", href: `${claim}#supporting-documents`, label: "Manage receipts", pending: "Removing attachment…" },
    withdrawn: { title: "Claim returned to draft", description: "Edit your expense or receipt files, then submit again when ready.", href: `${claim}/edit`, label: "Edit claim details", pending: "Returning to draft…" },
    revised: { title: "Draft ready for revision", description: "Update the details requested by Treasurer, then submit again.", href: `${claim}/edit`, label: "Edit claim details", pending: "Preparing draft…" },
    deleted: { title: "Draft deleted", description: "You can start a new claim or return to your claim history.", href: "/claims", label: "View my claims", pending: "Deleting draft…" },
    updated: { title: "Claim updated", description: "Check the latest status below before taking your next step.", href: claim, label: "View claim", pending: "Updating claim…" },
  };
  return messages[kind];
}
export function claimNextStep(status: ClaimStatus, owner: boolean, hasReceipt: boolean, hasPayout: boolean, infoPending: boolean) {
  if (owner && infoPending) return { title: "Your response is needed", description: "Read the Treasurer’s question, update your draft and explain your changes before resubmitting.", href: "#clarifications", label: "Answer the information request" };
  if (owner && status === "draft" && !hasReceipt) return { title: "Next: upload a receipt", description: "Your draft is saved. Add at least one receipt showing the purchase date and total.", href: "#supporting-documents", label: "Upload receipt" };
  if (owner && status === "draft" && !hasPayout) return { title: "Next: add your payout details", description: "Complete your Profile so Treasurer can reimburse you, then return to submit this draft.", href: "/profile", label: "Complete my profile" };
  if (owner && status === "draft") return { title: "Next: review & submit", description: "Check the expense and original receipt. AI checking is optional; submit when you are ready.", href: "#claim-review", label: "Review & submit" };
  if (status === "submitted") return owner ? { title: "Waiting for Treasurer", description: "Your claim has been submitted. Updates appear automatically; no further action is needed unless information is requested.", href: "/claims", label: "View my claims" } : { title: "Next: review the evidence", description: "Check the receipt and any duplicate warnings. Approve, request information or reject with a reason.", href: "#treasurer-review", label: "Go to review actions" };
  if (status === "approved") return owner ? { title: "Waiting for reimbursement", description: "Your claim is approved. Treasurer will record payment after making the external transfer.", href: "/claims", label: "View my claims" } : { title: "Next: transfer & record payment", description: "Complete the transfer outside MoneyLai, then add its reference and proof here. Approval alone does not transfer money.", href: "#record-payment", label: "Record reimbursement" };
  if (status === "rejected" && owner) return { title: "Next: read the reason and revise", description: "Start a revision below, correct the requested details and resubmit for another review.", href: "#claim-review", label: "Review rejection & revise" };
  return { title: status === "paid" ? "Reimbursement complete" : "Waiting for the claimant", description: status === "paid" ? "The payment and audit history are saved below." : "The claimant needs to reply before this claim returns for review.", href: owner ? "/claims" : "/treasury", label: owner ? "View my claims" : "Return to review desk" };
}
