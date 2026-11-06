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
    + ['"**/armeabi-v7a/*.so"', '"**/x86_64/*.so"', '"**/x86/*.so"']
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
        g = g.replace("defaultConfig {", 'defaultConfig {\n        ndk { abiFilters += listOf("arm64-v8a") }', 1)
        f.write_text(g)
        print("abiFilters set")

print("android patched")
