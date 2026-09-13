export interface RelayConfig {
  /** Base URL of the demo server, e.g. http://192.168.1.20:3000 */
  serverUrl: string;
  /** Matches SMS_RELAY_SECRET on the server. */
  secret: string;
  /** Sender fragments to forward. Empty means forward nothing. */
  senders: string[];
  /**
   * Human-chosen label for this build, e.g. "Bhavesh's phone" — set by us
   * per build so messages from different test phones are distinguishable
   * on the harness dashboard even before the device model is known.
   */
  deviceLabel: string;
}
