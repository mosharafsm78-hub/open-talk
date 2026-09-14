# Open Talk deployment runbook

## Web
1. Create the Supabase production project.
2. Apply supabase/schema.sql.
3. Configure Auth redirect URLs for the production domain.
4. Add Netlify environment variables from docs/PRODUCTION-ENV.md.
5. Connect GitHub repository to Netlify and deploy the default branch.
6. Verify /api/health, authentication, profile lock and database RLS.

## Realtime
Configure authenticated matching, WebRTC signaling and TURN. Never place TURN/API provider secrets in client code.

## AI
Configure the server-side AI provider. Process only consented conversation data. Persist structured level evidence and improvement items, not unnecessary raw audio.

## Android
1. Install Node dependencies in mobile/.
2. Add the Android platform with Capacitor.
3. Sync the web build.
4. Test microphone permissions, background/foreground transitions, network loss/reconnect, push notifications and account deletion.
5. Generate a signed Android App Bundle and use Play Console internal testing before release.
