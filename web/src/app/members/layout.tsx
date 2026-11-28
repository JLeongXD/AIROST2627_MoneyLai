import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
export default function MembersLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
