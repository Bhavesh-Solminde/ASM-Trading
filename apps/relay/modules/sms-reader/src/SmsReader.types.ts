export interface IncomingSms {
  /** DLT header such as AX-ICICIB, or a phone number. */
  sender: string;
  body: string;
  /** Epoch milliseconds, from the device clock. */
  receivedAt: number;
}

export type SmsReaderEvents = Record<
  "onSmsReceived",
  (event: IncomingSms) => void
>;
