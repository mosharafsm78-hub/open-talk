# Android release

Application ID: com.opentalk.app

Release path: development build → Play internal testing → closed testing → production.

Before release: verify microphone permission disclosures, privacy policy, account deletion, network recovery, notification behavior, authentication, WebRTC audio, report/block flows and crash monitoring on supported Android versions. Use a signed Android App Bundle for Play Console.

## Release build (automatic)
Every build runs `mobile/scripts/patch-android.py`, which adds microphone/audio permissions, the microphone foreground service and the native `CallAudio` plugin (earpiece/speaker, audio focus). If these GitHub secrets exist the AAB is signed for Google Play, otherwise it is unsigned (testing only): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The version code increases automatically with each run.

## Relay (TURN) setup
Set two Supabase function secrets: `METERED_DOMAIN` and `METERED_SECRET_KEY`. Without them calls still work on most networks but not behind strict NATs.
