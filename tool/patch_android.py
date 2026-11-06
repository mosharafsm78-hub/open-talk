"""Applies Open Talk's Android settings to the generated Flutter android/ folder."""
import re
import pathlib

root = pathlib.Path("android/app")

# --- Manifest: permissions + app label -------------------------------------
manifest = root / "src/main/AndroidManifest.xml"
text = manifest.read_text()
perms = [
    "android.permission.INTERNET",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.BLUETOOTH",
]
block = "".join(
    f'    <uses-permission android:name="{p}"/>\n' for p in perms if p not in text
)
if block:
    text = text.replace("<application", block + "    <application", 1)
text = re.sub(r'android:label="[^"]*"', 'android:label="Open Talk"', text, count=1)
manifest.write_text(text)

# --- Gradle: minSdk 24 (Agora requirement) ---------------------------------
for name in ("build.gradle.kts", "build.gradle"):
    f = root / name
    if f.exists():
        g = f.read_text()
        g = re.sub(r"minSdk\s*=\s*[^\n]+", "minSdk = 24", g)
        g = re.sub(r"minSdkVersion\s+[^\n]+", "minSdkVersion 24", g)
        f.write_text(g)

print("android patched")
