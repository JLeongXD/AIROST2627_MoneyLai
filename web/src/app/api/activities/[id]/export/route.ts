import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildActivityPack, ExportLimitError, type ActivityExportSnapshot } from "@/lib/reports/activity-pack";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Export is initiated by this site's UI using the caller's cookie session.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Invalid activity ID." }, { status: 400, headers });
  let cleanup: (() => Promise<unknown>) | undefined;
  try {
    const client = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return Response.json({ error: "Please sign in again." }, { status: 401, headers });
    const { data: profile, error: roleError } = await client.from("profiles").select("role").eq("id", user.id).single();
    if (roleError || !["treasurer", "president"].includes(profile?.role)) return Response.json({ error: "Only Treasurer or President can export an activity." }, { status: 403, headers });
    const { data, error } = await client.rpc("ml_activity_export", { p_activity_id: id });
    if (error) {
      const missing = error.code === "PGRST202" || error.code === "42883";
      return Response.json({ error: missing ? "Export setup is missing. Run 012_activity_exports_only.sql in Supabase, then try again." : error.message }, { status: missing ? 503 : 400, headers });
    }
    const snapshot = data as ActivityExportSnapshot;
    // Never accept a broader scope than the caller's verified role.
    snapshot.scope = profile.role === "treasurer" ? "treasurer_evidence" : "president_summary";
    const pack = await buildActivityPack(snapshot, async (bucket, path) => {
      const result = await client.storage.from(bucket).download(path);
      if (result.error || !result.data) throw new Error("Evidence unavailable.");
      return new Uint8Array(await result.data.arrayBuffer());
    });
    const storage = client.storage.from("activity-exports");
    const old = await storage.list(user.id, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    const abandoned = (old.data ?? []).filter(f => f.created_at && Date.parse(f.created_at) < Date.now() - 3600000).map(f => `${user.id}/${f.name}`);
    if (abandoned.length) await storage.remove(abandoned);
    const path = `${user.id}/${crypto.randomUUID()}.zip`;
    const upload = await storage.upload(path, pack.bytes, { contentType: "application/zip", upsert: false });
    if (upload.error) throw new Error("Could not prepare the download. Check that migration 012 has been applied, then retry.");
    cleanup = () => storage.remove([path]);
    const signed = await storage.createSignedUrl(path, 120, { download: pack.filename });
    if (signed.error || !signed.data) throw new Error("Could not create a download link. Please try again.");
    // Return a small response; the ZIP is fetched directly from private Storage.
    return Response.json({ url: signed.data.signedUrl, path, filename: pack.filename, issues: pack.issues }, { headers });
  } catch (error) {
    if (cleanup) await cleanup();
    return Response.json({ error: error instanceof ExportLimitError ? error.message : "The activity pack could not be generated. Please retry; if it persists, contact the maintainer." }, { status: error instanceof ExportLimitError ? 413 : 500, headers });
  }
}
