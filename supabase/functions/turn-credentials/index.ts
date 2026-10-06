// Issues short-lived TURN relay credentials to signed-in users, so no relay
// secret ever ships in the public app code.
// Secrets (set in Supabase > Edge Functions > Secrets):
//   METERED_DOMAIN      e.g. opentalk.metered.live
//   METERED_SECRET_KEY  the Metered secret key (NOT the public API key)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return json({ error: "unauthorized" }, 401);

  const domain = Deno.env.get("METERED_DOMAIN");
  const secret = Deno.env.get("METERED_SECRET_KEY");
  if (!domain || !secret) return json({ error: "relay_not_configured" }, 503);

  try {
    // Create a credential that expires in 2 hours, then fetch its ICE servers.
    const created = await fetch(`https://${domain}/api/v1/turn/credential?secretKey=${secret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiryInSeconds: 7200, label: user.id.slice(0, 8) }),
    });
    if (!created.ok) throw new Error("credential_create_" + created.status);
    const { apiKey } = await created.json();
    const res = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`);
    if (!res.ok) throw new Error("credential_list_" + res.status);
    return json({ iceServers: await res.json() });
  } catch (_err) {
    return json({ error: "relay_unavailable" }, 502);
  }
});
