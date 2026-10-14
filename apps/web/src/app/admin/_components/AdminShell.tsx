"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../_lib/icons";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  badge?: number | undefined;
  urgent?: boolean;
  /** queue colour class (see admin.css "Queue colours") */
  tone?: string;
};
type NavGroup = { label?: string; items: NavItem[] };

// Work that needs a decision leads; reference pages follow.
const NAV = (b: Record<string, number>): NavGroup[] => [
  { items: [{ href: "/admin", label: "Overview", icon: "grid" }] },
  {
    label: "Queues",
    items: [
      { href: "/admin/deposits", label: "Deposits", icon: "depositIn", badge: b.deposits, tone: "q-deposit" },
      { href: "/admin/withdrawals", label: "Withdrawals", icon: "payoutOut", badge: b.withdrawals, tone: "q-withdraw" },
      { href: "/admin/kyc", label: "KYC", icon: "idCard", badge: b.kyc, tone: "q-kyc" },
      { href: "/admin/fraud", label: "Fraud", icon: "shieldAlert", badge: b.fraud, urgent: true, tone: "q-fraud" },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/admin/users", label: "Users", icon: "users" },
      { href: "/admin/affiliates", label: "Affiliates", icon: "broadcast" },
      { href: "/admin/markets", label: "Markets", icon: "candles" },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/admin/house-pnl", label: "Treasury & P&L", icon: "trend" },
      { href: "/admin/messages", label: "Bank messages", icon: "message" },
      { href: "/admin/audit", label: "Audit log", icon: "scroll" },
      {
        href: "/admin/reconciliation",
        label: "Reconciliation",
        icon: "ledger",
        badge: b.reconciliation,
        urgent: true,
        tone: "q-recon",
      },
    ],
  },
];

// Title for the phone top bar (desktop pages carry their own heading).
const TITLES: [string, string][] = [
  ["/admin/deposits", "Deposits"],
  ["/admin/withdrawals", "Withdrawals"],
  ["/admin/kyc", "KYC"],
  ["/admin/fraud", "Fraud"],
  ["/admin/users", "Users"],
  ["/admin/affiliates", "Affiliates"],
  ["/admin/markets", "Markets"],
  ["/admin/house-pnl", "Treasury & P&L"],
  ["/admin/messages", "Bank messages"],
  ["/admin/audit", "Audit log"],
  ["/admin/reconciliation", "Reconciliation"],
  ["/admin/settings", "Settings"],
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  return (
    <Link
      href={item.href}
      aria-current={isActive(pathname, item.href) ? "page" : undefined}
      className={`admin-nav__item${item.tone ? ` ${item.tone}` : ""}${isActive(pathname, item.href) ? " active" : ""}`}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {item.badge ? (
        <span className={`admin-nav__badge${item.urgent ? " red" : ""}`}>{item.badge}</span>
      ) : null}
    </Link>
  );
}

export function AdminShell({
  children,
  badges = {},
}: {
  children: ReactNode;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const findRef = useRef<HTMLInputElement | null>(null);

  // close the phone drawer on navigation
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // "/" jumps to the find box, unless the operator is already typing somewhere
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      findRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function onFind(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const v = e.currentTarget.value.trim();
    e.currentTarget.value = "";
    e.currentTarget.blur();
    router.push(v ? `/admin/users?q=${encodeURIComponent(v)}` : "/admin/users");
  }

  const title = pathname === "/admin" ? "Overview" : (TITLES.find(([p]) => isActive(pathname, p))?.[1] ?? "Admin");

  return (
    <div className={`admin-shell${navOpen ? " nav-open" : ""}`}>
      {navOpen ? <div className="admin-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" /> : null}

      <aside className="admin-sidebar" aria-label="Admin">
        <Link className="admin-sidebar__brand" href="/admin">
          <img src="/brand/indianxtrade-wordmark.png" alt="IndianxTrade" />
          <span className="admin-tagline">Admin</span>
        </Link>

        <label className="admin-find">
          <Icon name="search" size={16} />
          <input ref={findRef} type="search" placeholder="Find a user" aria-label="Find a user by name or email" onKeyDown={onFind} />
          <kbd className="admin-kbd" aria-hidden="true">
            /
          </kbd>
        </label>

        <nav className="admin-nav" aria-label="Admin sections">
          {NAV(badges).map((g, i) => (
            <div key={g.label ?? i} style={{ display: "contents" }}>
              {g.label ? <div className="admin-nav__label">{g.label}</div> : null}
              {g.items.map((it) => (
                <NavLink key={it.href} item={it} pathname={pathname} />
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar__foot">
          <NavLink item={{ href: "/admin/settings", label: "Settings", icon: "settings" }} pathname={pathname} />
          <div className="admin-userchip">
            <span className="admin-avatar" style={{ width: 30, height: 30 }}>
              OP
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="nm">Operator</div>
              <div className="rl">Admin console</div>
            </div>
            <a className="admin-icon-btn" href="/api/admin/logout" aria-label="Sign out" title="Sign out" style={{ marginLeft: "auto" }}>
              <Icon name="logout" size={17} />
            </a>
          </div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-icon-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Icon name="menu" />
          </button>
          <img src="/brand/indianxtrade-wordmark.png" alt="IndianxTrade" />
          <span className="admin-topbar__title">{title}</span>
        </header>
        <main className="admin-view">{children}</main>
      </div>

      {/* Phone only: the queues one tap away; everything else sits under More. */}
      <nav className="admin-bottomnav" aria-label="Queues">
        {(
          [
            ["/admin", "Home", "grid", 0, ""],
            ["/admin/deposits", "Deposits", "depositIn", badges.deposits ?? 0, "q-deposit"],
            ["/admin/withdrawals", "Payouts", "payoutOut", badges.withdrawals ?? 0, "q-withdraw"],
            ["/admin/kyc", "KYC", "idCard", badges.kyc ?? 0, "q-kyc"],
          ] as const
        ).map(([href, label, icon, count, tone]) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            className={[tone, isActive(pathname, href) ? "active" : ""].filter(Boolean).join(" ") || undefined}
          >
            <Icon name={icon} size={20} />
            {label}
            {count ? <span className="b">{count}</span> : null}
          </Link>
        ))}
        <button type="button" onClick={() => setNavOpen(true)} aria-label="More sections">
          <Icon name="menu" size={20} />
          More
          {(badges.fraud ?? 0) + (badges.reconciliation ?? 0) ? (
            <span className="b red">{(badges.fraud ?? 0) + (badges.reconciliation ?? 0)}</span>
          ) : null}
        </button>
      </nav>
    </div>
  );
}
