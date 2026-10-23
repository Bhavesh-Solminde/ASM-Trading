"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useChartProtection, setChartProtection } from "@/lib/chart-protection-preference";
import { USD_INR_RATE } from "@/lib/currency";
import { formatMinor } from "@/lib/format-money";
import { isMuted, setMuted } from "@/lib/sound";
import { Icon, type IconName } from "@/components/shell/Icon";
import { initialsFor, kycBadge, type KycTone } from "./profile-display";
import { LinkRow, ListGroup, ToggleRow } from "./SettingsList";

export interface HubAccount {
  id: string;
  type: "LIVE" | "DEMO";
  currency: string;
  /** Real + bonus, minor units. */
  balanceMinor: number;
  /** Withdrawable minor units (LIVE only). */
  withdrawableMinor?: number;
}

const KYC_TEXT: Record<KycTone, string> = {
  up: "text-up",
  caution: "text-caution",
  down: "text-down",
  neutral: "text-ink-2",
};
const KYC_PILL: Record<KycTone, string> = {
  up: "bg-up/12 text-up",
  caution: "bg-caution/12 text-caution",
  down: "bg-down/12 text-down",
  neutral: "bg-tile text-ink-2",
};

function ActionTile({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link
      href={href}
      className="grid h-14 place-content-center justify-items-center gap-1 rounded-[14px] bg-white/[0.06] text-xs font-bold text-ink hover:bg-white/10"
    >
      <Icon name={icon} className="size-[18px]" strokeWidth={2.2} />
      {label}
    </Link>
  );
}

/**
 * The Account tab. Profile header, a Live/Demo balance card with the actions
 * that make sense for each, then grouped links to the settings sub-pages, the
 * sound toggle, support and sign-out. Everything that changes data lives on
 * the sub-pages (and keeps its existing logic); this screen only navigates.
 */
export function AccountHub({
  name,
  email,
  kycStatus,
  accounts,
  signOut,
}: {
  name: string;
  email: string;
  kycStatus: string;
  accounts: HubAccount[];
  /** The sign-out rows (client component supplied by the page). */
  signOut: React.ReactNode;
}) {
  const chartProtection = useChartProtection();
  const live = accounts.find((a) => a.type === "LIVE");
  const demo = accounts.find((a) => a.type === "DEMO");
  const [pick, setPick] = useState<"LIVE" | "DEMO">(live ? "LIVE" : "DEMO");
  const shown = (pick === "LIVE" ? live : demo) ?? live ?? demo;
  const isLive = shown?.type === "LIVE";

  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => setSoundOn(!isMuted()), []);

  const kyc = kycBadge(kycStatus);
  const target = shown?.currency === "INR" ? "USD" : "INR";
  const cardTint = isLive
    ? "bg-[color-mix(in_srgb,var(--color-up)_7%,var(--color-ground))]"
    : "bg-tile";

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-[52px] shrink-0 place-items-center rounded-full bg-brand-fill/25 text-lg font-extrabold text-brand"
        >
          {initialsFor(name)}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-[17px] font-bold">{name}</span>
          <span className="truncate text-[13px] text-ink-2">{email}</span>
        </span>
        <Link
          href="/account/verify"
          className={`ml-auto inline-flex h-[26px] shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-extrabold ${KYC_PILL[kyc.tone]}`}
        >
          {kyc.tone === "up" ? <Icon name="check" className="size-3" strokeWidth={3} /> : null}
          {kyc.label}
        </Link>
      </div>

      {shown ? (
        <div className="grid gap-2.5">
          {live && demo ? (
            <div role="group" aria-label="Accounts" className="flex gap-1.5">
              {(["LIVE", "DEMO"] as const).map((t) => {
                const on = pick === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPick(t)}
                    className={`relative h-9 rounded-full px-4 text-[13px] font-bold after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] ${
                      on ? "bg-ink text-ground" : "bg-tile text-ink-2 hover:text-ink"
                    }`}
                  >
                    {t === "LIVE" ? "Live" : "Demo"}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div
            className={`rounded-[20px] p-[18px] ${cardTint}`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-extrabold tracking-[0.12em] ${
                  isLive ? "bg-up text-up-ink" : "border border-dotted border-ink-3 text-ink-2"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    isLive ? "bg-down shadow-[0_0_6px_var(--color-down)] live-pulse" : "bg-ink-3"
                  }`}
                />
                {isLive ? "LIVE" : "DEMO"}
              </span>
              <span className="text-xs font-bold text-ink-2">{shown.currency}</span>
            </div>
            <p className="mt-3.5 text-xs text-ink-2">Balance</p>
            <p className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums">
              {formatMinor(shown.balanceMinor, shown.currency)}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {isLive
                ? `Withdrawable ${formatMinor(shown.withdrawableMinor ?? 0, shown.currency)}`
                : "Practice money · resets any time"}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <ActionTile href="/deposit" icon="plus" label="Deposit" />
              {isLive ? (
                <ActionTile href="/withdrawal" icon="up" label="Withdraw" />
              ) : (
                <ActionTile href="/account/demo" icon="history" label="Reset" />
              )}
              <ActionTile href="/account/currency" icon="swap" label={`To ${target}`} />
            </div>
          </div>
        </div>
      ) : null}

      <ListGroup title="Profile">
        <LinkRow href="/account/profile" icon="user" label="Personal details" />
        <LinkRow
          href="/account/verify"
          icon="shield"
          label="Identity verification"
          value={kyc.label}
          valueClass={`font-semibold ${KYC_TEXT[kyc.tone]}`}
        />
      </ListGroup>

      <ListGroup title="Preferences">
        <ToggleRow icon="trade" label="Chart SL/TP controls" checked={chartProtection} onChange={setChartProtection} />
        <li className="px-4 pb-3 text-xs text-ink-2">Show optional chart controls. Hiding them keeps saved SL/TP active. Saved on this browser.</li>
        <LinkRow
          href="/account/currency"
          icon="currency"
          label="Currency"
          value={`${(live ?? shown)?.currency ?? "INR"} · ₹${USD_INR_RATE} = $1`}
        />
        {demo ? (
          <LinkRow
            href="/account/demo"
            icon="wallet"
            label="Demo balance"
            value={formatMinor(demo.balanceMinor, demo.currency)}
          />
        ) : null}
        <ToggleRow
          icon={soundOn ? "sound" : "muted"}
          label="Trade sounds"
          checked={soundOn}
          onChange={(on) => {
            setSoundOn(on);
            setMuted(!on);
          }}
        />
      </ListGroup>

      <ListGroup>
        <LinkRow href="/history" icon="history" label="History" />
        <LinkRow href="/support" icon="help" label="Help & support" />
      </ListGroup>

      {signOut}
    </div>
  );
}
