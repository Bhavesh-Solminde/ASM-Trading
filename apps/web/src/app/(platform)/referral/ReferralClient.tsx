"use client";

import { useState } from "react";
import Link from "next/link";

interface ReferralClientProps {
  referralCode: string;
  referralUrl: string;
  /** Real program numbers for the existing stat cards; the Total earned label is preformatted. */
  stats: { totalReferrals: number; activeTraders: number; totalEarned: string };
  /** Program terms in force, preformatted (₹ amounts) on the server. */
  terms: { reward: string; minDeposit: string; minTrade: string; friendBonusPct: number };
}

export function ReferralClient({ referralCode, referralUrl, stats, terms }: ReferralClientProps) {
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
    <div className="flex flex-col gap-6 phone:gap-4">
      {/* Referral Link Hero Box */}
      <section className="relative overflow-hidden rounded-xl border border-rule bg-gradient-to-br from-panel via-tile to-ground p-6 phone:p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
              Affiliate Program
            </span>
            <span className="rounded-full bg-up/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-up">
              {terms.reward} per qualified friend
            </span>
          </div>

          <h2 className="text-lg font-bold tracking-tight text-ink">
            Your friend gets a {terms.friendBonusPct}% first-deposit bonus
          </h2>
          <p className="max-w-xl text-xs text-ink-2">
            Share your link or code. You earn {terms.reward} once for each invited friend who qualifies.
          </p>
        </div>

        {/* Link Bar */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-rule bg-ground/80 px-3.5 py-2.5 text-xs phone:min-h-11">
            <span className="font-mono text-ink-2 truncate select-all">{referralUrl}</span>
          </div>
          <button
            type="button"
            onClick={() => void copyToClipboard()}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-fill px-5 py-2.5 text-xs font-semibold text-white transition-transform hover:bg-brand-fill-hi active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 phone:h-11 phone:py-0"
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
        <div className="flex flex-col gap-1 rounded-xl border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Total Referrals</span>
          <span className="text-xl font-bold tracking-tight text-ink">{stats.totalReferrals}</span>
          <span className="text-[10px] text-ink-3">Registered users</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Active Traders</span>
          <span className="text-xl font-bold tracking-tight text-ink">{stats.activeTraders}</span>
          <span className="text-[10px] text-ink-3">Funded accounts</span>
        </div>
        <Link href="/referral/earnings" className="flex flex-col gap-1 rounded-xl border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Total Earned</span>
          <span className="text-xl font-bold tracking-tight text-up">{stats.totalEarned}</span>
          <span className="text-[10px] text-ink-3">View earnings &amp; withdraw →</span>
        </Link>
        <div className="flex flex-col gap-1 rounded-xl border border-rule bg-panel p-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Your Reward</span>
          <span className="text-xl font-bold tracking-tight text-brand">{terms.reward}</span>
          <span className="text-[10px] text-ink-3">Per qualified friend</span>
        </div>
      </section>

      {/* How It Works */}
      <section className="flex flex-col gap-3 rounded-xl border border-rule bg-panel p-5 phone:p-4">
        <h3 className="text-sm font-semibold tracking-tight text-ink">How the referral program works</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
              1
            </div>
            <h4 className="text-xs font-semibold text-ink">Share your link</h4>
            <p className="text-[11px] leading-relaxed text-ink-2">
              Send your personal link or code to friends. They get a {terms.friendBonusPct}% bonus on their first deposit.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
              2
            </div>
            <h4 className="text-xs font-semibold text-ink">They qualify</h4>
            <p className="text-[11px] leading-relaxed text-ink-2">
              A friend qualifies after a completed deposit of at least {terms.minDeposit} and a settled live trade of at least{" "}
              {terms.minTrade} of their own money.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex size-7 items-center justify-center rounded-full bg-up/15 text-xs font-bold text-up">
              3
            </div>
            <h4 className="text-xs font-semibold text-ink">You get {terms.reward}</h4>
            <p className="text-[11px] leading-relaxed text-ink-2">
              Once per qualified friend. It stays pending until the day closes (midnight IST), then you can move it to your
              trading balance or withdraw it.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
