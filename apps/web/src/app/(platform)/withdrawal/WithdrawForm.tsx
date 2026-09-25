"use client";

import { useState } from "react";
import { DEPOSIT_METHODS } from "@asm/contracts";
import { certificateHtml, type CertificateData } from "@/lib/certificate";

export function WithdrawForm({
  accountId,
  withdrawableMinor,
}: {
  accountId: string;
  withdrawableMinor: number;
}) {
  const [amountMajor, setAmountMajor] = useState(Math.max(1, Math.floor(withdrawableMinor / 100)));
  const [method, setMethod] = useState<(typeof DEPOSIT_METHODS)[number]>("PhonePe");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [cert, setCert] = useState<CertificateData | null>(null);
  const [emailed, setEmailed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/withdrawals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, amount: Math.round(amountMajor * 100), method }),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        certificate?: CertificateData;
        emailed?: boolean;
      };
      setCert(data.certificate ?? null);
      setEmailed(Boolean(data.emailed));
      setDone(true);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not request that withdrawal.");
  }

  const certDoc = cert
    ? `<!doctype html><html><head><meta charset="utf-8"><title>ASM Trade certificate</title></head><body style="margin:0;padding:20px;background:#000;">${certificateHtml(cert)}</body></html>`
    : "";

  function downloadCertificate() {
    if (!cert) return;
    const blob = new Blob([certDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asm-certificate-${cert.refId}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (done) {
    return (
      <div className="grid gap-4">
        <p className="rounded border border-[var(--color-up)] bg-[var(--color-up)]/10 p-3 text-sm text-[var(--color-up)]">
          Withdrawal requested. Requests are processed in 3 business days.
          {emailed ? " A certificate has been emailed to you." : ""}
        </p>
        {cert ? (
          <>
            <iframe
              title="Withdrawal certificate"
              srcDoc={certDoc}
              sandbox=""
              className="h-[360px] w-full rounded border border-rule bg-black"
            />
            <button
              type="button"
              onClick={downloadCertificate}
              className="justify-self-start rounded border border-brand px-4 py-2 text-xs font-bold uppercase tracking-[0.06em] text-brand hover:bg-brand/10"
            >
              Download certificate
            </button>
          </>
        ) : null}
      </div>
    );
  }

  if (withdrawableMinor <= 0) {
    return (
      <div className="rounded border border-[var(--color-down)] bg-[var(--color-warn-bg)] p-4">
        <p className="text-sm text-[var(--color-down)]">
          You can withdraw money from your balance to the method you used for depositing. Requests
          are processed in 3 business days.
        </p>
        <a
          href="/deposit"
          className="mt-2 inline-block text-xs font-bold text-[var(--color-up)] underline underline-offset-4 phone:py-3"
        >
          Make a deposit
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="wamount"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Amount
        </label>
        <input
          id="wamount"
          type="number"
          min={1}
          max={Math.floor(withdrawableMinor / 100)}
          value={amountMajor}
          onChange={(e) => setAmountMajor(Number(e.target.value))}
          className="mt-1 w-full rounded border border-[var(--color-rule)] bg-[var(--color-tile)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]"
        />
      </div>

      <div>
        <label
          htmlFor="wmethod"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Method
        </label>
        <select
          id="wmethod"
          value={method}
          onChange={(e) => setMethod(e.target.value as (typeof DEPOSIT_METHODS)[number])}
          className="mt-1 w-full rounded border border-[var(--color-rule)] bg-[var(--color-tile)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
        >
          {DEPOSIT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--color-ink-2)]">
          Only a method you have already deposited with is accepted.
        </p>
      </div>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <button
        type="submit"
        className="rounded bg-[var(--color-brand)] px-4 py-2.5 text-sm font-bold text-[var(--color-brand-ink)]"
      >
        Request withdrawal
      </button>
    </form>
  );
}
