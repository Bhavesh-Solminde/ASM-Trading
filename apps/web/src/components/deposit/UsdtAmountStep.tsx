"use client";

import { useState } from "react";
import { USDT_NETWORK_INFO, type UsdtNetwork } from "@asm/contracts";

const QUICK = [25, 50, 100, 250];
const RECOMMENDED: UsdtNetwork = "bsc";

export function UsdtAmountStep({
  networks,
  onBack,
  gatewayNetworks,
  bonusPercent,
}: {
  /** Enabled networks, server-computed; never empty (DepositFlow guards that). */
  networks: UsdtNetwork[];
  onBack: () => void;
  /** Networks on the Tatum payment gateway: a unique address per deposit, no unique-cents amount. */
  gatewayNetworks: UsdtNetwork[];
  /** Bonus tier this deposit will get (0 once every tier is used). */
  bonusPercent: number;
}) {
  // BSC is recommended (fees of cents for the sender and for us), so it is
  // preselected whenever it is offered.
  const [network, setNetwork] = useState<UsdtNetwork>(
    networks.includes(RECOMMENDED) ? RECOMMENDED : (networks[0] ?? "tron"),
  );
  const info = USDT_NETWORK_INFO[network];
  const gateway = gatewayNetworks.includes(network);
  const [amountMajor, setAmountMajor] = useState(25);
  // Optional, shared-address (time-slot) networks only: the wallet the user
  // will send from. A payment from it is confirmed whatever the amount.
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function proceed() {
    setBusy(true);
    setError(null);

    const res = await fetch("/api/deposits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "USDT",
        network,
        amountUsdtMinor: Math.round(amountMajor * 100),
        ...(!gateway && sender.trim() ? { senderAddress: sender.trim() } : {}),
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { checkoutToken: string };
      window.location.href = `/checkout/${data.checkoutToken}`;
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not start that deposit.");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4 phone:py-3"
      >
        &lsaquo; Change method
      </button>

      {networks.length > 1 ? (
        <div>
          <p
            id="usdt-network-label"
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
          >
            Network
          </p>
          <div
            role="radiogroup"
            aria-labelledby="usdt-network-label"
            className="mt-1 flex gap-2 phone:flex-col"
          >
            {networks.map((n) => {
              const selected = n === network;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setNetwork(n)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold phone:min-h-11 phone:py-2.5 phone:text-sm ${
                    selected
                      ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-brand)]"
                      : "border-[var(--color-rule)] bg-[var(--color-panel)] text-[var(--color-ink)]"
                  }`}
                >
                  {USDT_NETWORK_INFO[n].shortLabel}
                  {n === RECOMMENDED ? (
                    <span className="mx-auto mt-1 block w-fit rounded-full bg-[var(--color-up)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-up)]">
                      Recommended
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-2)]">
            Pick the network you will send on. Sending on a different network
            than the one you choose here cannot be credited.
            {networks.includes(RECOMMENDED) ? (
              <> {USDT_NETWORK_INFO[RECOMMENDED].label} is recommended: its network fee is only a few cents.</>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-panel)] p-4">
        <p className="text-sm font-semibold">USDT ({info.standard})</p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--color-ink-2)]">
          <div>
            <dt>Min</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">$10.00</dd>
          </div>
          <div>
            <dt>Max</dt>
            <dd className="tabular-nums text-[var(--color-ink)]">$10,000.00</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd className="text-[var(--color-ink)]">{info.label}</dd>
          </div>
        </dl>
      </div>

      <div>
        <label
          htmlFor="usdt-amount"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Deposit amount
        </label>
        <input
          id="usdt-amount"
          type="number"
          min={10}
          max={10000}
          step={1}
          value={amountMajor}
          onChange={(e) => setAmountMajor(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-tile)] px-4 py-2.5 text-sm tabular-nums focus:border-brand phone:h-11 phone:py-0 phone:text-base"
        />
        <div className="mt-2 flex gap-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmountMajor(q)}
              className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-panel)] px-2 py-1.5 text-xs font-semibold phone:min-h-11 phone:py-2.5 phone:text-sm"
            >
              ${q.toLocaleString("en-US")}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/10 p-3 text-xs leading-relaxed text-[var(--color-brand)]">
        {gateway ? (
          <>
            You&rsquo;ll get a deposit address created just for this payment.
            Send at least the amount you enter here — anything above it is
            credited too. You&rsquo;ll have <strong>30 minutes</strong> to send it.
          </>
        ) : (
          <>
            The next page shows an address reserved for you alone for{" "}
            <strong>5 minutes</strong>. Send the amount you enter here within that
            time — anything within 3% of it is credited automatically.
          </>
        )}
      </div>

      {!gateway ? (
        <div>
          <label
            htmlFor="usdt-sender"
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
          >
            Your wallet address
          </label>
          <input
            id="usdt-sender"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={network === "tron" ? "T…" : "0x…"}
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--color-rule)] bg-[var(--color-tile)] px-4 py-2.5 font-mono text-xs focus:border-brand phone:h-11 phone:py-0 phone:text-sm"
          />
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-2)]">
            For faster deposit confirmation, enter the wallet address you&rsquo;ll
            send from — a payment from it is confirmed automatically even if the
            amount differs. Sending from an exchange? It pays from its own wallet,
            so you can leave this empty.
          </p>
        </div>
      ) : null}

      <div className="flex items-baseline justify-between border-t border-dashed border-[var(--color-rule)] pt-3 text-sm">
        <span className="text-[var(--color-ink-2)]">You will receive</span>
        <span className="font-semibold tabular-nums">${amountMajor.toLocaleString("en-US")}</span>
      </div>

      {bonusPercent > 0 ? (
        <>
          <div className="flex items-baseline justify-between text-xs text-[var(--color-ink-2)]">
            <span>Bonus ({bonusPercent}%)</span>
            <span className="tabular-nums text-[var(--color-up)]">
              +${Math.floor((amountMajor * bonusPercent) / 100).toLocaleString("en-US")}
            </span>
          </div>
          <p className="-mt-2 text-[11px] text-[var(--color-ink-3)]">
            Bonus is for trading only and can&apos;t be withdrawn.
          </p>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-down">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void proceed()}
        className="rounded-lg bg-brand-fill px-4 py-3 text-sm font-bold text-white hover:bg-brand-fill-hi disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Starting…" : "Proceed to Pay"}
      </button>
    </div>
  );
}
