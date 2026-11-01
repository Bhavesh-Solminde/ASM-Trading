#!/usr/bin/env bash
# Called after prebuild. Passwords remain environment values, never Gradle source or process arguments.
set -euo pipefail
: "${IXT_KEYSTORE_PATH:?}" "${IXT_STORE_PASSWORD:?}" "${IXT_KEY_ALIAS:?}" "${IXT_KEY_PASSWORD:?}"
[[ -f "$IXT_KEYSTORE_PATH" ]] || { echo "Keystore file is missing" >&2; exit 1; }
gradle=android/app/build.gradle
[[ -f "$gradle" ]] || { echo "Run Expo Android prebuild first" >&2; exit 1; }
if grep -q 'IXT_RELEASE_SIGNING' "$gradle"; then exit 0; fi
cat >> "$gradle" <<'GRADLE'

// IXT_RELEASE_SIGNING: never substitute secret values into generated source.
android {
  signingConfigs {
    ixtRelease {
      storeFile file(System.getenv("IXT_KEYSTORE_PATH"))
      storePassword System.getenv("IXT_STORE_PASSWORD")
      keyAlias System.getenv("IXT_KEY_ALIAS")
      keyPassword System.getenv("IXT_KEY_PASSWORD")
    }
  }
  buildTypes { release { signingConfig signingConfigs.ixtRelease } }
}
GRADLE
