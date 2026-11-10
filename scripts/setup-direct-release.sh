#!/usr/bin/env bash
# Owner-run first-release setup. Private keys stay outside the repository.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/.." && pwd)"
keys="${APP_KEYS_DIR:-$HOME/.indianxtrade/keys}"
repo=Bhavesh-Solminde/ASM-Trading
keytool="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}/bin/keytool"
[[ -x "$keytool" ]] || { echo 'Install JDK 17 or set JAVA_HOME first.' >&2; exit 1; }
command -v gh >/dev/null
gh auth status >/dev/null 2>&1 || { echo 'Sign into GitHub with gh auth login first.' >&2; exit 1; }
printf '\nIndianxTrade first website release\n\n'
printf 'This creates your publisher keys in %s and configures private GitHub release secrets.\n' "$keys"
printf 'Keep an offline backup of this folder and its password: future app updates need the same keys.\n'
read -r -p 'Create or resume your signing setup? [y/N] ' answer
[[ "$answer" == y || "$answer" == Y ]] || exit 0
read -r -s -p 'Choose a signing password (at least 12 characters): ' IXT_OWNER_PASSWORD
printf '\n'
read -r -s -p 'Repeat the password: ' confirmation
printf '\n'
[[ "${#IXT_OWNER_PASSWORD}" -ge 12 && "$IXT_OWNER_PASSWORD" == "$confirmation" ]] || { echo 'Passwords must match and have at least 12 characters.' >&2; exit 1; }
unset confirmation
export IXT_OWNER_PASSWORD
trap 'unset IXT_OWNER_PASSWORD' EXIT
mkdir -p "$keys"
chmod 700 "$keys"
if [[ ! -e "$keys/direct.p12" ]]; then
  "$keytool" -genkeypair -keystore "$keys/direct.p12" -storetype PKCS12 \
    -storepass:env IXT_OWNER_PASSWORD -keypass:env IXT_OWNER_PASSWORD \
    -alias indianxtrade-direct -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=IndianxTrade'
fi
"$keytool" -list -keystore "$keys/direct.p12" -storepass:env IXT_OWNER_PASSWORD -alias indianxtrade-direct >/dev/null
if [[ ! -e "$keys/expo-updates-private.pem" && ! -e "$keys/certificate.pem" ]]; then
  openssl req -new -x509 -newkey rsa:2048 -keyout "$keys/expo-updates-private.pem" \
    -out "$keys/certificate.pem" -days 3650 -subj '/CN=IndianxTrade Updates' -passout env:IXT_OWNER_PASSWORD
fi
# Refuse a partial/mismatched OTA identity; never overwrite a previously generated key.
test -s "$keys/expo-updates-private.pem" && test -s "$keys/certificate.pem"
private_fingerprint=$(openssl pkey -in "$keys/expo-updates-private.pem" -passin env:IXT_OWNER_PASSWORD -pubout -outform DER | shasum -a 256)
certificate_fingerprint=$(openssl x509 -in "$keys/certificate.pem" -pubkey -noout | openssl pkey -pubin -outform DER | shasum -a 256)
[[ "$private_fingerprint" == "$certificate_fingerprint" ]] || { echo 'OTA certificate does not match its key.' >&2; exit 1; }
openssl x509 -in "$keys/certificate.pem" -noout -checkend 86400 >/dev/null
chmod 600 "$keys/direct.p12" "$keys/expo-updates-private.pem" "$keys/certificate.pem"
cp "$keys/certificate.pem" "$root/apps/mobile/certs/certificate.pem"
base64 < "$keys/direct.p12" | gh secret set DIRECT_KEYSTORE_B64 --repo "$repo"
printf '%s' "$IXT_OWNER_PASSWORD" | gh secret set DIRECT_KEYSTORE_PASSWORD --repo "$repo"
printf '%s' "$IXT_OWNER_PASSWORD" | gh secret set DIRECT_KEY_PASSWORD --repo "$repo"
printf '%s' indianxtrade-direct | gh secret set DIRECT_KEY_ALIAS --repo "$repo"
printf '\nSigning setup complete. Only the public certificate was copied into the project.\n'
printf 'Back up %s securely, then return to Codex so the release can be built and tested.\n' "$keys"
