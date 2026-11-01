// The session store stays independent of native notification modules (including before app boot).
let unregister: (session: string) => Promise<void> = async () => {};
export function configurePushCleanup(fn: (session: string) => Promise<void>) { unregister = fn; }
export function unregisterPushDevice(session: string): Promise<void> {
  try { return unregister(session).catch(() => {}); } catch { return Promise.resolve(); }
}
