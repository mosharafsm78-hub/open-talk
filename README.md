# Open Talk

Android app for learning English by talking live with real people.

- **App:** Flutter (`lib/`)
- **Accounts, matching, safety:** Supabase (Postgres + Auth). Schema lives in `supabase/migrations/`.
- **Live voice:** Agora RTC. Tokens are issued by the `agora-token` Supabase Edge Function; the App Certificate is stored only as a server secret.
- **Builds:** GitHub Actions builds a release APK on every push (Actions tab, artifact `open-talk-apk`).
