import { createClient } from "jsr:@supabase/supabase-js@2";

// Permanently deletes the signed-in user's account.
//
// Every table that references the user (profiles, calls, call_signals,
// coin_transactions, daily_progress, user_milestones, user_milestone_rewards,
// match_passes, reports, blocks, waiting_users) is set to ON DELETE CASCADE from
// auth.users / profiles, so removing the auth user removes all of that data.
// The only data outside those tables is the user's avatar files in storage,
// which we remove first.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(401, { error: "Unauthorized" });

    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: "Bearer " + token } },
    });
    const { data: { user }, error: userError } = await asUser.auth.getUser(token);
    if (userError || !user) return json(401, { error: "Invalid session" });

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "DELETE") {
      return json(400, { error: 'Type DELETE to confirm account deletion.' });
    }

    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!adminKey) throw new Error("Missing server key.");
    const admin = createClient(url, adminKey);

    // Best effort: remove avatar files. A storage hiccup must not leave the
    // person unable to delete their account, so failures are logged only.
    try {
      const bucket = admin.storage.from("profile-avatars");
      const { data: files } = await bucket.list(user.id, { limit: 1000 });
      if (files && files.length) {
        await bucket.remove(files.map((f) => `${user.id}/${f.name}`));
      }
    } catch (err) {
      console.error("delete-account: avatar cleanup failed", err);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("delete-account: deleteUser failed", deleteError);
      return json(500, { error: "We could not delete your account. Please try again." });
    }

    return json(200, { deleted: true });
  } catch (err) {
    console.error("delete-account: unexpected error", err);
    return json(500, { error: "We could not delete your account. Please try again." });
  }
});
