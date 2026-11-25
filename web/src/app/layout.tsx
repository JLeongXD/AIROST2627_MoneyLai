import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import "./globals.css";
import "./hybrid.css";
import "./hybrid-shell.css";
import "./readability.css";
export const metadata: Metadata = {
  title: { default: "MoneyLai", template: "%s · MoneyLai" },
  description: "Club budgets, expense claims and reimbursements in one place.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FeedbackProvider><AuthProvider>{children}</AuthProvider></FeedbackProvider>
      </body>
    </html>
  );
}
