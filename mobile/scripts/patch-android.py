#!/usr/bin/env python3
"""Run after `npx cap add android`. Adds call permissions, the microphone
foreground service, the native call-audio plugin, signing and versioning."""
import pathlib, re, shutil, sys

root = pathlib.Path(__file__).resolve().parent.parent
android = root / "android"
pkg = android / "app/src/main/java/com/opentalk/app"
pkg.mkdir(parents=True, exist_ok=True)
for f in ("CallAudioPlugin.java", "CallService.java", "MainActivity.java"):
    shutil.copy(root / "native" / f, pkg / f)

mf = android / "app/src/main/AndroidManifest.xml"
t = mf.read_text()
perms = [
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.POST_NOTIFICATIONS",
]
add = "".join(f'    <uses-permission android:name="{p}" />\n' for p in perms if p not in t)
if add:
    t = t.replace("</manifest>", add + "</manifest>")
if "CallService" not in t:
    t = t.replace("</application>",
        '        <service android:name=".CallService" android:exported="false" android:foregroundServiceType="microphone" />\n    </application>')
mf.write_text(t)

gradle = android / "app/build.gradle"
g = gradle.read_text()
if "OPEN_TALK_PATCH" not in g:
    g += '''
// OPEN_TALK_PATCH: versioning + release signing driven by environment variables
android {
    defaultConfig {
        versionCode (System.getenv("VERSION_CODE") ?: "1").toInteger()
        versionName System.getenv("VERSION_NAME") ?: "1.0"
    }
    if (System.getenv("KEYSTORE_PATH")) {
        signingConfigs {
            release {
                storeFile file(System.getenv("KEYSTORE_PATH"))
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEY_PASSWORD")
            }
        }
        buildTypes { release { signingConfig signingConfigs.release } }
    }
}
'''
    gradle.write_text(g)
print("Android project patched")
