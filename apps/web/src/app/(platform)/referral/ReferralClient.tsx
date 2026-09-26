"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/Icon";

interface ReferralClientProps {
  referralCode: string;
  referralUrl: string;
}

export function ReferralClient({ referralCode, referralUrl }: ReferralClientProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Referral Link Hero Box */}
      <section className="relative overflow-hidden rounded-xl border border-rule bg-gradient-to-br from-panel via-tile to-ground p-6 phone:p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
              Affiliate Program
            </span>
            <span className="rounded-full bg-up/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-up">
              Up to 50% RevShare
            </span>
          </div>

          <h2 className="text-xl font-bold tracking-tight text-ink phone:text-lg">
            Invite friends & earn continuous commission
          </h2>
          <p className="max-w-xl text-xs text-ink-2">
            Share your unique referral link. Whenever your referrals register and place trades, you receive a direct revenue share credited directly to your balance.
          </p>
        </div>

        {/* Link Bar */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-rule bg-ground/80 px-3.5 py-2.5 text-xs">
            <span className="font-mono text-ink-2 truncate select-all">{referralUrl}</span>
          </div>
          <button
            type="button"
            onClick={() => void copyToClipboard()}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-xs font-semibold text-brand-ink transition-transform active:scale-95 phone:py-3"
          >
            {copied ? (
              <>
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>Copied!</span>
              </>
            ) : (
              <>
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copy Link</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-3">
          <span>Referral Code:</span>
          <span className="font-mono font-bold text-ink-2">{referralCode}</span>
        </div>
      </section>

      {/* Stats Bento Grid */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-lg border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Total Referrals</span>
          <span className="text-xl font-bold tracking-tight text-ink">0</span>
          <span className="text-[10px] text-ink-3">Registered users</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Active Traders</span>
          <span className="text-xl font-bold tracking-tight text-ink">0</span>
          <span className="text-[10px] text-ink-3">Funded accounts</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Total Earned</span>
          <span className="text-xl font-bold tracking-tight text-up">$0.00</span>
          <span className="text-[10px] text-ink-3">All-time earnings</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Current Tier</span>
          <span className="text-xl font-bold tracking-tight text-brand">50%</span>
          <span className="text-[10px] text-ink-3">Top VIP tier</span>
        </div>
      </section>

      {/* How It Works */}
      <section className="flex flex-col gap-3 rounded-lg border border-rule bg-panel p-5">
        <h3 className="text-sm font-semibold tracking-tight text-ink">How the referral program works</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
              1
            </div>
            <h4 className="text-xs font-semibold text-ink">Share your link</h4>
            <p className="text-[11px] leading-relaxed text-ink-2">
              Send your personal link or code to prospective traders, friends, or your trading community.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
              2
            </div>
            <h4 className="text-xs font-semibold text-ink">They trade</h4>
            <p className="text-[11px] leading-relaxed text-ink-2">
              Whenever your referred traders place binary options trades on live market assets, volume accumulates.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-up/15 text-xs font-bold text-up">
              3
            </div>
            <h4 className="text-xs font-semibold text-ink">Instant payouts</h4>
            <p className="text-[11px] leading-relaxed text-ink-2">
              Commissions are automatically settled and ready for immediate withdrawal or trading.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
