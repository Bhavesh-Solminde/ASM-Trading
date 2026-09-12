import { NativeModule, requireNativeModule } from "expo";
import type { IncomingSms, SmsReaderEvents } from "./src/SmsReader.types";

declare class SmsReaderModule extends NativeModule<SmsReaderEvents> {
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  isListening(): Promise<boolean>;
}

const SmsReader = requireNativeModule<SmsReaderModule>("SmsReader");

export function startListening(): Promise<void> {
  return SmsReader.startListening();
}

export function stopListening(): Promise<void> {
  return SmsReader.stopListening();
}

export function isListening(): Promise<boolean> {
  return SmsReader.isListening();
}

export function addSmsListener(
  listener: (event: IncomingSms) => void,
): { remove(): void } {
  return SmsReader.addListener("onSmsReceived", listener);
}

export type { IncomingSms };
