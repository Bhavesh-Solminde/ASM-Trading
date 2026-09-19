import { prisma } from "@asm/db";
import type { BankFeed, Credit } from "./types";

/**
 * A fake bank that pays for whatever the user just claimed.
 *
 * On a timer it looks for deposits the user has confirmed (PENDING_CONFIRMATION,
 * so a UTR has been entered) and emits an exact-amount credit for each — the
 * paise-precise amount is what makes the credit unambiguously attributable, so
 * the emitted credit carries the deposit's own reserved amount, its VPA, and
 * the claimed reference. `failureRate` is the fraction of otherwise-payable
 * deposits that silently never get a credit, standing in for a real payment
 * that never lands — those fall through to the admin queue.
 *
 * The feed only emits; the runner persists and matches. A deposit is emitted at
 * most once (tracked in memory) so a credit is never injected twice while the
 * first is still being reconciled.
 */
export function createSimulatedFeed(opts: { delayMs: number; failureRate: number }): BankFeed {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const emitted = new Set<string>();

  async function tick(onCredit: (credit: Credit) => void): Promise<void> {
    const pending = await prisma.deposit.findMany({
      where: { status: "PENDING_CONFIRMATION" },
      select: { id: true, amountInr: true, vpa: true, claimedUtr: true },
    });

    for (const deposit of pending) {
      if (emitted.has(deposit.id)) continue;
      emitted.add(deposit.id);

      // A drawn miss models a payment that simply never arrives.
      if (draw() < opts.failureRate) continue;

      onCredit({
        amountInr: deposit.amountInr,
        vpa: deposit.vpa,
        utr: deposit.claimedUtr,
        receivedAt: new Date(),
        raw: `SIMULATED credit of paise ${deposit.amountInr}`,
      });
    }
  }

  return {
    async start(onCredit): Promise<void> {
      if (running) return;
      running = true;
      const schedule = (): void => {
        timer = setTimeout(() => {
          void tick(onCredit).finally(() => {
            if (running) schedule();
          });
        }, opts.delayMs);
      };
      schedule();
    },
    async stop(): Promise<void> {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** A uniform [0,1) draw from crypto — Math.random is banned by the lint gate. */
function draw(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}
