// The session store stays independent of native notification modules (including before app boot).
let unregister: (session: string) => Promise<void> = async () => {};
export function configurePushCleanup(fn: (session: string) => Promise<void>) { unregister = fn; }
export async function unregisterPushDevice(session: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Even a hung native module cannot delay remote auth revocation indefinitely. Local sign-out has finished.
    await Promise.race([unregister(session).catch(() => {}), new Promise<void>((resolve) => { timer = setTimeout(resolve, 30_000); })]);
  } catch { /* Push cleanup must never prevent session revocation. */ }
  finally { if (timer) clearTimeout(timer); }
}
