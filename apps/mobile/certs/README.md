# OTA trust certificate

The owner creates and backs up the signing keypair offline. Copy **only** the public X.509 certificate to `certificate.pem` here. Never commit the private key. Until the real certificate exists, OTA is disabled and release preflight fails. Development builds continue to work.

See `docs/mobile-release.md` for setup, rotation and release checks.
