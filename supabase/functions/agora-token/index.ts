// Issues a short-lived Agora RTC token, but only to a user who is a
// participant of an active Open Talk call. The App Certificate is read from
// the AGORA_APP_CERTIFICATE secret and never leaves the server.
import { createClient } from "npm:@supabase/supabase-js@2";
import { RtcRole, RtcTokenBuilder } from "npm:agora-token@2.0.5";

const AGORA_APP_ID = "0025f1acf06d492c8e1426521a24e5c6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const certificate = Deno.env.get("AGORA_APP_CERTIFICATE");
    if (!certificate) return json({ error: "server not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return json({ error: "unauthorized" }, 401);

    const { channel } = await req.json();
    if (typeof channel !== "string" || channel.length === 0) {
      return json({ error: "bad request" }, 400);
    }

    // RLS only lets a participant see their own calls.
    const { data: call } = await supabase
      .from("calls")
      .select("id")
      .eq("channel", channel)
      .eq("status", "active")
      .maybeSingle();
    if (!call) return json({ error: "forbidden" }, 403);

    const ttl = 3600;
    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      certificate,
      channel,
      0,
      RtcRole.PUBLISHER,
      ttl,
      ttl,
    );
    return json({ token });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
