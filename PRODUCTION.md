# Open Talk production architecture

The repository now contains the deployable web shell plus a secure serverless boundary and database schema.

## Required production services
1. Supabase: Auth + Postgres + Realtime.
2. Netlify: web hosting + serverless API.
3. WebRTC: direct live audio between matched users.
4. Speech-to-text + LLM service: analyze consented conversation audio/transcript, determine level, and generate a continuously updated "Need to Improve" list.
5. Moderation: reports, rate limits, automated abuse checks and human review.

## Security decisions
- Profile edits are locked server-side for 30 days; localStorage is not trusted.
- User data is scoped with row-level security.
- API secrets belong only in Netlify environment variables.
- Gender reports should create a moderation case, not an automatic ban solely because another user reports it. Ban decisions need evidence/review to reduce harassment and false reports.

## Environment variables
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY (server only, never expose to browser)
AI_API_KEY (server only)

## Launch sequence
Run supabase/schema.sql, configure environment variables in Netlify, connect the GitHub repo to Netlify, then implement/enable WebRTC matching and AI analysis before public release.
