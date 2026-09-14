# Open Talk API contract

## Health
GET /api/health

## Profile
GET /api/profile — authenticated user profile
POST /api/profile — authenticated profile update; server rejects updates during the 30-day lock

## Planned endpoints
POST /api/match
POST /api/conversations/start
POST /api/conversations/:id/complete
POST /api/reports
GET /api/me/improvements
GET /api/me/progress

All private endpoints require a valid Supabase access token. AI provider keys and service-role credentials remain server-side only.
