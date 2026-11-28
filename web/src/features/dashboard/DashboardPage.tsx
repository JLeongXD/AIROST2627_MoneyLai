"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Notice, Loading } from "@/components/UI";
import { useLoad } from "@/lib/useLoad";
import { listActivities, listClaims } from "@/lib/api";
import DashboardOverview from "./DashboardOverview";

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const president = profile?.role === "president";
  const treasurer = profile?.role === "treasurer";
  useEffect(() => {
    if (president) router.replace("/president");
  }, [president, router]);
  const state = useLoad(async () => {
    if (president) return { activities: [], claims: [] };
    const [activities, claims] = await Promise.all([
      listActivities(),
      listClaims(treasurer ? undefined : user!.id),
    ]);
    return { activities, claims };
  }, [user?.id, treasurer, president]);

  if (president || state.loading) return <Loading />;
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data || !user || !profile) return null;
  return <DashboardOverview
    name={profile.display_name.split(" ")[0] || "friend"}
    userId={user.id}
    treasurer={treasurer}
    {...state.data}
  />;
}
