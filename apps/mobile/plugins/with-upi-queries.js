const { withAndroidManifest } = require("expo/config-plugins");

/** What the pay screen probes with `Linking.canOpenURL`: the system `upi://` link and each named app's own scheme. */
const UPI_SCHEMES = ["upi", "phonepe", "tez", "paytmmp"];

/**
 * Android 11+ hides other apps unless the manifest says which links the app will ask about. Without these
 * `<queries>`, `canOpenURL` answers false for every UPI app, and the pay screen would only ever offer the chooser.
 * Pure, and safe to run twice: a scheme already declared is not added again.
 */
function addUpiQueries(manifest) {
  manifest.queries = manifest.queries ?? [];
  const declared = new Set(
    manifest.queries.flatMap((q) => q.intent ?? []).flatMap((i) => (i.data ?? []).map((d) => d.$ && d.$["android:scheme"])),
  );
  const missing = UPI_SCHEMES.filter((scheme) => !declared.has(scheme));
  if (missing.length > 0) {
    manifest.queries.push({
      intent: missing.map((scheme) => ({
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        data: [{ $: { "android:scheme": scheme } }],
      })),
    });
  }
  return manifest;
}

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    addUpiQueries(cfg.modResults.manifest);
    return cfg;
  });
};
module.exports.addUpiQueries = addUpiQueries;
module.exports.UPI_SCHEMES = UPI_SCHEMES;
