"""Applies Open Talk's Android settings to the generated Flutter android/ folder."""
import os
import re
import pathlib

# Target CPUs (comma separated): arm64-v8a for the test APK, arm64+arm32 for the Play bundle,
# x86_64 for the CI emulator smoke test.
ABIS = os.environ.get("OT_ABI", "arm64-v8a").split(",")
ALL_ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]

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
    # Needed for the proximity (screen-off near the ear) wake lock; without it the call is silently refused.
    "android.permission.WAKE_LOCK",
]
block = "".join(
    f'    <uses-permission android:name="{p}"/>\n' for p in perms if p not in text
)
if block:
    text = text.replace("<application", block + "    <application", 1)
text = re.sub(r'android:label="[^"]*"', 'android:label="Open Talk"', text, count=1)
# Agora's SDK manifest pulls in screen-sharing foreground-service permissions the app never uses;
# strip them so Play does not require a foreground-service declaration.
if 'xmlns:tools=' not in text:
    text = text.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
unused = [
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.SYSTEM_ALERT_WINDOW",
]
rm = "".join(
    f'    <uses-permission android:name="{p}" tools:node="remove"/>\n' for p in unused
)
text = text.replace("<application", rm + "    <application", 1)
# AdMob app id (Google's public TEST id; replace with the real one before release).
if "com.google.android.gms.ads.APPLICATION_ID" not in text:
    text = re.sub(
        r"(<application[^>]*>)",
        r'\1\n        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-3940256099942544~3347511713"/>',
        text, count=1)
manifest.write_text(text)

# --- Gradle: minSdk 24 (Agora requirement) ---------------------------------
for name in ("build.gradle.kts", "build.gradle"):
    f = root / name
    if f.exists():
        g = f.read_text()
        g = re.sub(r"minSdk\s*=\s*[^\n]+", "minSdk = 24", g)
        g = re.sub(r"minSdkVersion\s+[^\n]+", "minSdkVersion 24", g)
        f.write_text(g)

# --- Force a modern compileSdk on every plugin (older plugins pin 31) ---------
inject = """
subprojects {
    afterEvaluate {
        val ext = extensions.findByName("android")
        if (ext != null) {
            ext.javaClass.methods
                .firstOrNull { it.name == "compileSdkVersion" && it.parameterTypes.size == 1 && it.parameterTypes[0] == Int::class.javaPrimitiveType }
                ?.invoke(ext, 36)
        }
    }
}
"""
for name in ("build.gradle.kts",):
    f = pathlib.Path("android") / name
    if f.exists():
        g = f.read_text()
        if "compileSdkVersion" not in g:
            f.write_text(inject + g)
        print("injected into", f)

# --- Drop Agora extensions a voice-only app never uses (big size win) ---------
exts = [
    "ai_echo_cancellation", "ai_echo_cancellation_ll", "ai_noise_suppression",
    "ai_noise_suppression_ll", "audio_beauty", "clear_vision", "content_inspect",
    "face_capture", "face_detection", "lip_sync", "pvc", "screen_capture",
    "segmentation", "spatial_audio", "super_resolution", "video_av1_decoder",
    "video_av1_encoder", "video_quality_analyzer",
]
excl = ",\n                ".join(
    [f'"**/libagora_{e}_extension.so"' for e in exts]
    + [f'"**/{a}/*.so"' for a in ALL_ABIS if a not in ABIS]
)
pack = f"""
    packaging {{
        jniLibs {{
            excludes += setOf(
                {excl}
            )
        }}
    }}
"""
for name in ("build.gradle.kts",):
    f = root / name
    if f.exists():
        g = f.read_text()
        if "libagora_" not in g:
            g = g.replace("android {", "android {" + pack, 1)
            f.write_text(g)
            print("excluded agora extensions in", f)

# --- Keep only 64-bit ARM native libs in the test APK (Agora ships all ABIs) --
f = root / "build.gradle.kts"
if f.exists():
    g = f.read_text()
    if "abiFilters" not in g:
        g = g.replace("defaultConfig {", 'defaultConfig {\n        ndk { abiFilters += listOf(%s) }' % ", ".join('"%s"' % a for a in ABIS), 1)
        f.write_text(g)
        print("abiFilters set")

# --- Release build: turn R8 code shrinking off. It strips classes that the ads/WorkManager
# libraries load by reflection (WorkDatabase_Impl), which crashed the app at launch.
f = root / "build.gradle.kts"
if f.exists():
    g = f.read_text()
    if "isMinifyEnabled" not in g:
        g = g.replace(
            'signingConfig = signingConfigs.getByName("debug")',
            'signingConfig = signingConfigs.getByName("debug")\n            isMinifyEnabled = false\n            isShrinkResources = false',
            1,
        )
        f.write_text(g)
        print("minify disabled")

# --- Play Store signing (only when OT_SIGN=1; reads android/key.properties) ---
if os.environ.get("OT_SIGN") == "1":
    f = root / "build.gradle.kts"
    g = f.read_text()
    if "keystoreProps" not in g:
        g = "import java.io.FileInputStream\nimport java.util.Properties\n\n" + g
        g = g.replace(
            "android {",
            """val keystoreProps = Properties().apply {
    load(FileInputStream(rootProject.file("key.properties")))
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProps["keyAlias"] as String
            keyPassword = keystoreProps["keyPassword"] as String
            storeFile = rootProject.file("app/upload.jks")
            storePassword = keystoreProps["storePassword"] as String
        }
    }""",
            1,
        )
        g = g.replace(
            'signingConfig = signingConfigs.getByName("debug")',
            'signingConfig = signingConfigs.getByName("release")',
            1,
        )
        f.write_text(g)
        print("release signing configured")

print("android patched")
