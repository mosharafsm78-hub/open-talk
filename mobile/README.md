# Open Talk Mobile

Android-first mobile shell for Open Talk.

## Current strategy

The existing Open Talk web experience remains the shared UI/product foundation. Capacitor packages that experience into Android while keeping the production backend authoritative.

The mobile app is intentionally **not** a separate toy frontend. It shares:

- Supabase identity and profile data
- server-authoritative matching
- coin ledger and time-based matching passes
- milestones and achievements
- conversation history and progress
- safety/report/block state

## Build locally

From the repository root:

```bash
cd mobile
npm install
npx cap add android
npx cap sync android
npx cap open android
```

For a debug APK:

```bash
cd android
./gradlew assembleDebug
```

## Production gates

Before Play Store release, complete:

1. Supabase production configuration and RLS review.
2. Server-authoritative coin ledger and Google Play purchase verification.
3. Real-time matching and WebRTC/TURN.
4. Microphone permission and audio recovery testing.
5. Push notifications.
6. Report/block/moderation.
7. Account deletion and privacy/consent flows.
8. Signed Android App Bundle and Play Console internal testing.

Never place Google Play service-account credentials or other private secrets in the repository.

## Monetization model

Coins are **consumable digital currency**. Google Play classifies in-app currency such as coins/gems as consumable one-time products. Purchases must be verified server-side before coins are credited.

Open Talk should sell coins, while matching controls consume coins or activate a time-based pass. A pass should not create a per-call paywall: normal human conversations remain available according to the product's free/paid matching rules.

Recommended matching passes:

- Gender preference — 12 hours
- Country preference — 12 hours
- Speaking-level preference — 12 hours
- Priority matching — 12 hours
- Smart Match (combined controls) — 24 hours

The backend must decide whether a pass is active and whether a requested match is chargeable. The client must never be trusted to deduct or award coins.
