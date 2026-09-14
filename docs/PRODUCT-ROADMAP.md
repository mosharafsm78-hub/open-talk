# Open Talk — Production Target

## Core experience
- Account creation and secure profiles
- 30-day profile lock enforced server-side
- AI determines speaking level from conversation evidence
- Matching based on level, goals and improvement areas
- Real-time voice conversation
- Post-call transcript/analysis
- Continuous Need to Improve list that evolves after every conversation
- Progress, milestones and achievements

## Safety
- Report user flow
- Report categories and evidence
- Rate limits and anti-spam
- Moderation queue
- False-report protection
- Gender/profile integrity handled through evidence and moderation, not automatic bans from a single report

## Mobile
The UI is responsive/PWA-ready. The production mobile app should share the same backend/API and be packaged for Android first, then iOS.

## Release gates
Do not call the product production-ready until auth, database, realtime voice, AI analysis, moderation, privacy/consent, monitoring, backups and mobile builds are tested end-to-end.
