"use client";

import { useEffect, useRef, useState } from "react";

// The server route enforces the same cap; we mirror it here to avoid a
// pointless round-trip on an oversized file.
const MAX_SCREENSHOT_BYTES = 5_000_000;

// A TRON transaction ID is 32 bytes of hex; wallets sometimes show a 0x
// prefix. The server normalizes either form.
const TX_HASH_RE = /^(0x)?[0-9a-fA-F]{64}$/;

interface UploadResponse {
  url?: string;
  error?: string;
}

/**
 * Proof-of-payment for a USDT transfer the watcher couldn't auto-match
 * (wrong amount, or sent after the window closed). Submitting only attaches
 * the hash for an admin to review — it never credits anything by itself.
 */
export function UsdtClaimForm({
  depositId,
  existingTxHash,
}: {
  depositId: string;
  existingTxHash: string | null;
}) {
  const [txHash, setTxHash] = useState("");
  const [screenshot, setScreenshot] = useState<{
    url: string;
    name: string;
    previewUrl: string;
  } | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setScreenshot(null);
      return;
    }
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setError("Attach a PNG, JPEG or WebP screenshot.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError("Screenshot is too large — keep it under 5MB.");
      e.target.value = "";
      return;
    }

    setError(null);
    setState("uploading");
    const previewUrl = URL.createObjectURL(file);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = previewUrl;

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/deposits/${depositId}/screenshot`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as UploadResponse;
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Upload failed. Please try again.");
      }
      setScreenshot({ url: data.url, name: file.name, previewUrl });
    } catch (err) {
      // The screenshot is optional — the hash alone can still be submitted.
      URL.revokeObjectURL(previewUrl);
      previewRef.current = null;
      setScreenshot(null);
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      e.target.value = "";
    } finally {
      setState("idle");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hash = txHash.trim();
    if (!TX_HASH_RE.test(hash)) {
      setError("Paste the 64-character transaction hash from your wallet");
      return;
    }

    setState("busy");
    setError(null);

    try {
      const res = await fetch(`/api/deposits/${depositId}/usdt-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: hash,
          ...(screenshot ? { screenshotUrl: screenshot.url } : {}),
        }),
      });

      if (res.ok) {
        setState("done");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error ??
          (res.status === 401
            ? "Your session has ended — sign in again and retry."
            : res.status === 429
              ? "Too many attempts — please wait a minute and try again."
              : "Could not submit that transaction hash."),
      );
    } catch {
      setError("Couldn’t reach the server — check your connection and try again.");
    }
    setState("idle");
  }

  if (state === "done") {
    return (
      <div className="rounded-lg bg-[#efe7fb] p-4 text-center">
        <p className="text-sm font-semibold text-[#4b2d86]">Proof received</p>
        <p className="mt-1 text-xs text-[#6b5a8a]">
          Our team will review it and credit your account. You can close this page.
        </p>
        <a
          href="/trade"
          className="mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
        >
          Back to trading
        </a>
      </div>
    );
  }

  const uploading = state === "uploading";
  const submitting = state === "busy";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <label
        htmlFor="txHash"
        className="text-center text-xs font-bold uppercase tracking-wide text-[#5b2d9e]"
      >
        Transaction hash
      </label>
      <input
        id="txHash"
        required
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={txHash}
        onChange={(e) => setTxHash(e.target.value)}
        placeholder="64-character transaction ID"
        className="rounded-lg border border-[#d8cdf0] bg-white px-4 py-2.5 text-center font-mono text-xs text-[#241436] outline-none focus:border-[#5b2d9e]"
      />
      <p className="text-center text-[11px] text-[#6b5a8a]">
        Find it in your wallet&rsquo;s transaction details (TronLink: tap the
        transaction &rarr; Transaction ID).
      </p>

      <label
        htmlFor="screenshot"
        className="text-center text-xs font-bold uppercase tracking-wide text-[#5b2d9e]"
      >
        Payment screenshot (optional)
      </label>
      <input
        id="screenshot"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFile}
        disabled={uploading || submitting}
        className="rounded-lg border border-dashed border-[#d8cdf0] bg-white px-3 py-2 text-xs text-[#4b2d86] file:mr-3 file:rounded-md file:border-0 file:bg-[#efe7fb] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#5b2d9e] disabled:opacity-50"
      />
      {uploading ? (
        <p className="text-center text-[11px] text-[#6b5a8a]">Uploading screenshot…</p>
      ) : screenshot ? (
        <div className="flex items-center gap-3 rounded-lg bg-[#f6f1ff] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={screenshot.previewUrl} alt="" className="size-14 rounded object-cover" />
          <div className="min-w-0 flex-1 text-[11px] text-[#6b5a8a]">
            <div className="truncate font-semibold text-[#4b2d86]">{screenshot.name}</div>
            <div>Uploaded — sent with your transaction hash for review.</div>
          </div>
        </div>
      ) : (
        <p className="text-center text-[11px] text-[#6b5a8a]">
          Helps our team confirm the payment faster.
        </p>
      )}

      {error ? <p className="text-center text-xs text-[#b8384c]">{error}</p> : null}
      <button
        type="submit"
        disabled={uploading || submitting}
        className="rounded-lg bg-[#5b2d9e] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {submitting ? "Submitting…" : existingTxHash ? "Update your proof" : "Submit proof"}
      </button>
    </form>
  );
}
