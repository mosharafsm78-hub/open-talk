# Matching specification

Matching is automatic. Users never select an AI speaking level manually.

Inputs: availability, language, goals, current AI-estimated level, recent improvement priorities, blocked users, safety state and previous pair history.

Rules: never match blocked users; avoid immediate repeats; respect age/safety eligibility; prioritize compatible goals and a useful challenge; fall back gracefully when the pool is small. Matching must be server-authoritative and rate-limited.

Users can skip, leave, block and report at any time.