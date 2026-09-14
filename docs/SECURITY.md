# Security baseline

Never expose service-role or AI provider keys in the browser. Enforce Supabase RLS and validate profile fields server-side.

The 30-day profile lock must be enforced by the server; browser storage is only a UI cache.

Rate-limit matching, reports, profile writes and conversation creation. Store minimum necessary conversation data and define retention/deletion controls.

A gender authenticity report should enter moderation. One report alone should not automatically cause a permanent ban; repeated abuse, evidence and moderator review can lead to enforcement. Provide an appeal path.
