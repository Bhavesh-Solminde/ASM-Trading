import { NativeModule, requireNativeModule } from "expo";

export interface ActivityEntry {
  at: number;
  sender: string;
  bodyPreview: string;
  ok: boolean;
  detail: string;
}

interface Stats {
  sent: number;
  failed: number;
}

declare class SmsReaderModule extends NativeModule<Record<string, never>> {
  configure(
    serverUrl: string,
    secret: string,
    senders: string[],
    deviceLabel: string,
  ): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  isEnabled(): Promise<boolean>;
  getStats(): Promise<Stats>;
  getActivityLog(): Promise<ActivityEntry[]>;
  recordActivity(sender: string, ok: boolean, detail: string): Promise<void>;
  startForegroundService(): Promise<void>;
  stopForegroundService(): Promise<void>;
  setNotifEnabled(enabled: boolean): Promise<void>;
  isNotifEnabled(): Promise<boolean>;
  setListenPackages(packages: string[]): Promise<void>;
  getListenPackages(): Promise<string[]>;
  isNotifAccessGranted(): Promise<boolean>;
  openNotifAccessSettings(): Promise<void>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
}

const SmsReader = requireNativeModule<SmsReaderModule>("SmsReader");

export function configure(
  serverUrl: string,
  secret: string,
  senders: string[],
  deviceLabel: string,
): Promise<void> {
  return SmsReader.configure(serverUrl, secret, senders, deviceLabel);
}

export function setEnabled(enabled: boolean): Promise<void> {
  return SmsReader.setEnabled(enabled);
}

export function isEnabled(): Promise<boolean> {
  return SmsReader.isEnabled();
}

export function getStats(): Promise<Stats> {
  return SmsReader.getStats();
}

export function getActivityLog(): Promise<ActivityEntry[]> {
  return SmsReader.getActivityLog();
}

export function recordActivity(
  sender: string,
  ok: boolean,
  detail: string,
): Promise<void> {
  return SmsReader.recordActivity(sender, ok, detail);
}

export function startForegroundService(): Promise<void> {
  return SmsReader.startForegroundService();
}

export function stopForegroundService(): Promise<void> {
  return SmsReader.stopForegroundService();
}

export function requestIgnoreBatteryOptimizations(): Promise<void> {
  return SmsReader.requestIgnoreBatteryOptimizations();
}

export function setNotifEnabled(enabled: boolean): Promise<void> {
  return SmsReader.setNotifEnabled(enabled);
}

export function isNotifEnabled(): Promise<boolean> {
  return SmsReader.isNotifEnabled();
}

export function setListenPackages(packages: string[]): Promise<void> {
  return SmsReader.setListenPackages(packages);
}

export function getListenPackages(): Promise<string[]> {
  return SmsReader.getListenPackages();
}

export function isNotifAccessGranted(): Promise<boolean> {
  return SmsReader.isNotifAccessGranted();
}

export function openNotifAccessSettings(): Promise<void> {
  return SmsReader.openNotifAccessSettings();
}
