"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatedNumber, inr } from "./AffiliateMotion";
import styles from "./affiliate.module.css";

export function EarningsCalculator({ minimumDeposit, minimumTrade }: {
  minimumDeposit: number; minimumTrade: number;
}) {
  const [friends, setFriends] = useState(10);
  const [deposit, setDeposit] = useState(minimumDeposit);
  const maximumDeposit = Math.max(10_000, minimumDeposit * 20);
  const referredDeposits = friends * deposit;
  return (
    <div className={styles.calculator} data-reveal>
      <div className={styles.controls}>
        <div className={styles.sliderHeading}><label htmlFor="affiliate-friends">Friends who qualify</label><output htmlFor="affiliate-friends">{friends}</output></div>
        <input id="affiliate-friends" type="range" min={1} max={100} step={1} value={friends} aria-valuetext={`${friends} qualifying friends`} onChange={(e) => setFriends(Number(e.target.value))} />
        <div className={styles.rangeEnds}><span>1 friend</span><span>100 friends</span></div>
        <div className={`${styles.sliderHeading} mt-9`}><label htmlFor="affiliate-deposit">Each friend&apos;s first deposit</label><output htmlFor="affiliate-deposit">{inr(deposit)}</output></div>
        <input id="affiliate-deposit" type="range" min={minimumDeposit} max={maximumDeposit} step={minimumDeposit % 1 ? 0.01 : 1} value={deposit} aria-valuetext={`${inr(deposit)} first deposit per friend`} onChange={(e) => setDeposit(Number(e.target.value))} />
        <div className={styles.rangeEnds}><span>{inr(minimumDeposit)} minimum</span><span>{inr(maximumDeposit)}</span></div>
        <p className="mt-7 text-sm leading-relaxed text-ink-2">A friend qualifies after a real-money deposit of at least {inr(minimumDeposit)} and a completed real-money trade of at least {inr(minimumTrade)}.</p>
        <noscript><p className="mt-4 text-sm text-ink-2">Enable JavaScript to adjust this example.</p></noscript>
      </div>
      <div className={styles.result}>
        <span className={styles.eyebrow}>Your referral example</span>
        <p className={styles.resultNumber} data-testid="referral-deposits" aria-live="polite" aria-atomic="true"><AnimatedNumber value={referredDeposits} money /></p>
        <p className="text-sm text-ink-2">{friends} qualifying friends × {inr(deposit)} in first deposits</p>
        <div className="mt-7 flex gap-3 border-t border-brand/25 pt-6">
          <span aria-hidden="true" className="text-3xl text-brand">+</span>
          <div><h3 className="text-lg font-bold">Your earnings, your terms.</h3><p className="mt-1 text-sm leading-relaxed text-ink-2">First-deposit rewards and eligible Revenue Share are based on your personal affiliate terms.</p></div>
        </div>
        <Link href="/affiliate/login" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand">View your earnings terms <span aria-hidden="true">↗</span></Link>
        <p className="mt-6 text-xs leading-relaxed text-ink-2">This is a deposit example, not an earnings estimate. Rewards are paid when a friend qualifies.</p>
      </div>
    </div>
  );
}
