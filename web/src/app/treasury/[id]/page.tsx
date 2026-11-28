"use client";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Notice } from "@/components/UI";
import { ClaimDetailWorkspace } from "@/features/claims/ClaimDetailPage";

export default function TreasuryClaimPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  if (profile?.role !== "treasurer") return <Notice tone="error">Treasurer access is required.</Notice>;
  return <ClaimDetailWorkspace key={id} claimId={id} />;
}
