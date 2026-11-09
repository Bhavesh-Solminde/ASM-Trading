#!/usr/bin/env bash
# Full local/CI build or OTA export. Uploads only with APP_RELEASE_UPLOAD=1.
set -euo pipefail
mode="${1:?Usage: app-release.sh build|ota VERSION}"
version="${2:?Version is required}"
variant_selection="${APP_RELEASE_VARIANT:-all}"
[[ "$mode" == build || "$mode" == ota ]] || { echo "Mode must be build or ota" >&2; exit 1; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version must be MAJOR.MINOR.PATCH" >&2; exit 1; }
[[ "$variant_selection" == all || "$variant_selection" == direct ]] || { echo "APP_RELEASE_VARIANT must be all or direct" >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/apps/mobile"
keys="${APP_KEYS_DIR:-$HOME/.indianxtrade/keys}"
out="${APP_RELEASE_OUT_DIR:-$(mktemp -d)}"
mkdir -p "$out"
pkg="$(node -p 'require(process.argv[1]).version' "$app/package.json")"
[[ "$pkg" == "$version" ]] || { echo "Requested version differs from package.json" >&2; exit 1; }
[[ -f "$app/certs/certificate.pem" ]] || { echo "Owner setup required: public OTA certificate at apps/mobile/certs/certificate.pem" >&2; exit 1; }
openssl x509 -in "$app/certs/certificate.pem" -noout -checkend 86400 >/dev/null || { echo "OTA certificate is invalid or expired" >&2; exit 1; }
cd "$root"
pnpm install --frozen-lockfile --filter @asm/mobile...
pnpm --filter @asm/mobile test
pnpm --filter @asm/mobile typecheck
cd "$app"
export APP_RELEASE_BUILD=1
variants=(play direct)
if [[ "$variant_selection" == direct ]]; then variants=(direct); fi
for variant in "${variants[@]}"; do
  export APP_VARIANT="$variant"
  if [[ "$variant" == play ]]; then prefix=PLAY; else prefix=DIRECT; fi
  gs_var="${prefix}_GOOGLE_SERVICES_JSON"
  export GOOGLE_SERVICES_JSON="${!gs_var:-$keys/gs-$variant.json}"
  if [[ ! -s "$GOOGLE_SERVICES_JSON" ]]; then
    if [[ "$variant_selection" == direct && "$mode" == build ]]; then
      # The website APK supports email login without Firebase; never show a nonfunctional Google login.
      unset GOOGLE_SERVICES_JSON
      export APP_GOOGLE_WEB_CLIENT_ID=""
    else
      echo "Missing $variant Google services file" >&2; exit 1
    fi
  fi
  # expo config must describe the same native runtime which the update targets.
  cfg="$out/config-$variant.json"
  pnpm exec expo config --json --type public > "$cfg"
  node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync(process.argv[1]));if(c.version!==process.argv[2]||c.runtimeVersion!==`${process.argv[2]}-${process.argv[3]}`||!c.updates?.enabled)throw Error("Version/runtime/OTA configuration mismatch")' "$cfg" "$version" "$variant"
  if [[ "$mode" == build ]]; then
    key_var="${prefix}_KEYSTORE_PATH"; store_var="${prefix}_STORE_PASSWORD"; alias_var="${prefix}_KEY_ALIAS"; pass_var="${prefix}_KEY_PASSWORD"
    export IXT_KEYSTORE_PATH="${!key_var:-$keys/$variant.p12}"
    export IXT_STORE_PASSWORD="${!store_var:?Signing store password is required}"
    export IXT_KEY_ALIAS="${!alias_var:?Signing key alias is required}"
    export IXT_KEY_PASSWORD="${!pass_var:?Signing key password is required}"
    [[ -f "$IXT_KEYSTORE_PATH" ]] || { echo "Missing $variant keystore" >&2; exit 1; }
    pnpm exec expo prebuild --platform android --clean
    ./scripts/apply-signing.sh
    if [[ "$variant" == play ]]; then
      (cd android && ./gradlew bundleRelease --no-daemon)
      cp android/app/build/outputs/bundle/release/app-release.aab "$out/indianxtrade-$version-play.aab"
    else
      (cd android && ./gradlew assembleRelease --no-daemon)
      cp android/app/build/outputs/apk/release/app-release.apk "$out/indianxtrade-$version.apk"
      "${ANDROID_HOME:?}/build-tools/36.0.0/apksigner" verify --print-certs "$out/indianxtrade-$version.apk"
      (cd "$out" && shasum -a 256 "indianxtrade-$version.apk" > "indianxtrade-$version.apk.sha256")
    fi
    unset IXT_STORE_PASSWORD IXT_KEY_PASSWORD
  else
    runtime="$version-$variant"
    update_id="$(date -u +%Y%m%d%H%M%S)-$(git -C "$root" rev-parse --short HEAD)"
    dest="$out/updates/$runtime/$update_id"
    pnpm exec expo export --platform android --output-dir "$dest"
    cp "$cfg" "$dest/expoConfig.json"
    node -e 'const fs=require("fs");const path=require("path");const dir=process.argv[1];const f=path.join(dir,"metadata.json");const m=JSON.parse(fs.readFileSync(f));m.createdAt=new Date().toISOString();fs.writeFileSync(f,JSON.stringify(m));for(const asset of [m.fileMetadata.android.bundle,...m.fileMetadata.android.assets.map(a=>a.path)])if(!fs.statSync(path.join(dir,asset)).isFile())throw Error("Missing exported asset");fs.writeFileSync(path.join(dir,"READY"),"")' "$dest"
  fi
done
if [[ "${APP_RELEASE_UPLOAD:-0}" == 1 ]]; then
  : "${VPS_HOST:?}" "${VPS_USER:?}" "${VPS_SSH_KEY_FILE:?}"
  ssh_cmd=(ssh -i "$VPS_SSH_KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes)
  printf -v rsync_shell '%q ' "${ssh_cmd[@]}"
  if [[ "$mode" == build ]]; then
    "${ssh_cmd[@]}" "$VPS_USER@$VPS_HOST" 'mkdir -p /srv/app/releases'
    apk="$out/indianxtrade-$version.apk"
    checksum="$(shasum -a 256 "$apk" | cut -d ' ' -f 1)"
    # Published version URLs are immutable; a retry may upload only identical bytes.
    "${ssh_cmd[@]}" "$VPS_USER@$VPS_HOST" "if test -e /srv/app/releases/indianxtrade-$version.apk; then echo '$checksum  /srv/app/releases/indianxtrade-$version.apk' | sha256sum -c -; fi"
    rsync -av --delay-updates -e "$rsync_shell" "$out"/*.apk "$out"/*.sha256 "$VPS_USER@$VPS_HOST:/srv/app/releases/"
  else
    for dir in "$out"/updates/*/*; do
      runtime="$(basename "$(dirname "$dir")")"; id="$(basename "$dir")"
      "${ssh_cmd[@]}" "$VPS_USER@$VPS_HOST" "mkdir -p /srv/app/updates/$runtime/.stage-$id"
      rsync -av --delete -e "$rsync_shell" "$dir/" "$VPS_USER@$VPS_HOST:/srv/app/updates/$runtime/.stage-$id/"
      "${ssh_cmd[@]}" "$VPS_USER@$VPS_HOST" "test ! -e /srv/app/updates/$runtime/$id && mv /srv/app/updates/$runtime/.stage-$id /srv/app/updates/$runtime/$id"
    done
  fi
fi
printf 'Release artifacts: %s\n' "$out"
