# Open Talk Android

Open Talk uses Capacitor to package the existing responsive Open Talk web application as a native Android app.

## Build

The Android project is generated in CI so generated platform files do not have to be maintained by hand. CI copies the shared web app into `mobile/www`, generates the Android project, applies microphone/WebRTC permissions, syncs Capacitor, and produces a debug APK plus a release AAB.

## Architecture

The Android app uses the same Open Talk frontend and Supabase backend as the website. Authentication, profile, progress, coins, badges and conversation flows should remain synchronized across platforms.

Keep the mobile app on the same product logic as the web app unless a native Android capability is required.
