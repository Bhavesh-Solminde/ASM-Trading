export interface RelayConfig {
  /** Base URL of the demo server, e.g. http://192.168.1.20:3000 */
  serverUrl: string;
  /** Matches SMS_RELAY_SECRET on the server. */
  secret: string;
  /** Sender fragments to forward. Empty means forward nothing. */
  senders: string[];
}

export interface QueuedMessage {
  id: number;
  sender: string;
  body: string;
  receivedAt: number;
  attempts: number;
  nextAttemptAt: number;
}
