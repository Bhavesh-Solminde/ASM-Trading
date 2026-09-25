"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../_lib/icons";

type NavItem = { href: string; label: string; icon: IconName; badge?: number };
type NavGroup = { label: string; items: NavItem[] };

const NAV = (badges: Record<string, number>): NavGroup[] => [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: "grid" },
      { href: "/admin/users", label: "Users & Accounts", icon: "users" },
      { href: "/admin/markets", label: "Markets", icon: "coins" },
      {
        href: "/admin/deposits",
        label: "Deposits",
        icon: "inbox",
        ...(badges.deposits ? { badge: badges.deposits } : {}),
      },
      {
        href: "/admin/withdrawals",
        label: "Withdrawals",
        icon: "dollar",
        ...(badges.withdrawals ? { badge: badges.withdrawals } : {}),
      },
      {
        href: "/admin/fraud",
        label: "Fraud queue",
        icon: "shield",
        ...(badges.fraud ? { badge: badges.fraud } : {}),
      },
      { href: "/admin/messages", label: "Messages", icon: "message" },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/admin/audit", label: "Audit Log", icon: "scroll" },
      { href: "/admin/settings", label: "Settings", icon: "settings" },
    ],
  },
];

const TITLES: Record<string, { title: string; crumb: string }> = {
  "/admin": { title: "Overview", crumb: "Home / Overview" },
  "/admin/users": { title: "Users & Accounts", crumb: "Operations / Users" },
  "/admin/markets": { title: "Markets", crumb: "Operations / Markets" },
  "/admin/deposits": { title: "Deposits", crumb: "Operations / Deposits" },
  "/admin/withdrawals": { title: "Withdrawals", crumb: "Operations / Withdrawals" },
  "/admin/approvals": { title: "Approvals", crumb: "Operations / Approvals" },
  "/admin/fraud": { title: "Fraud queue", crumb: "Operations / Fraud queue" },
  "/admin/messages": { title: "Messages", crumb: "Operations / Messages" },
  "/admin/audit": { title: "Audit Log", crumb: "Governance / Audit Log" },
  "/admin/settings": { title: "Settings", crumb: "Governance / Settings" },
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const menuRef = useRef<HTMLDivElement | null>(null);

  // reflect the server-rendered theme once mounted, then own it client-side
  useEffect(() => {
    const root = document.getElementById("admin-root");
    const t = root?.dataset.adminTheme === "light" ? "light" : "dark";
    setTheme(t);
  }, []);

  // close the mobile drawer on navigation
  useEffect(() => {
    setNavOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.getElementById("admin-root");
    if (root) root.dataset.adminTheme = next;
    document.cookie = `asm_admin_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  }

  function onSearch(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const v = e.currentTarget.value.trim();
    e.currentTarget.value = "";
    router.push(v ? `/admin/users?q=${encodeURIComponent(v)}` : "/admin/users");
  }

  const meta = TITLES[pathname] ?? { title: "Console", crumb: "Admin" };
  const groups = NAV(badges);

  return (
    <div className={`admin-shell${navOpen ? " nav-open" : ""}`}>
      {navOpen ? (
        <div className="admin-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      ) : null}

      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand">
          <div className="admin-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/asm-logo.png" alt="ASM" />
          </div>
          <div>
            <div className="admin-brand-name">ASM Trading</div>
            <div className="admin-brand-sub">Console</div>
          </div>
        </div>

        <nav className="admin-nav">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="admin-nav__label">{g.label}</div>
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`admin-nav__item${isActive(pathname, it.href) ? " active" : ""}`}
                >
                  <Icon name={it.icon} />
                  <span>{it.label}</span>
                  {it.badge ? <span className="admin-nav__badge">{it.badge}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar__foot" ref={menuRef} style={{ position: "relative" }}>
          {menuOpen ? (
            <div className="admin-menu" role="menu">
              <Link className="admin-menu__item" href="/admin/settings">
                <Icon name="settings" size={16} />
                Settings
              </Link>
              <button className="admin-menu__item" onClick={toggleTheme}>
                <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <div className="admin-menu__sep" />
              <a className="admin-menu__item danger" href="/api/admin/logout">
                <Icon name="logout" size={16} />
                Sign out
              </a>
            </div>
          ) : null}
          <button
            className="admin-userchip"
            onClick={() => setMenuOpen((v) => !v)}
            style={{ border: "none", background: "transparent", cursor: "pointer" }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="admin-avatar" style={{ background: "#8A6215" }}>
              OP
            </span>
            <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
              <span className="nm" style={{ display: "block" }}>
                Operator
              </span>
              <span className="rl">Admin console</span>
            </span>
            <Icon name="settings" size={16} />
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button
            className="admin-icon-btn admin-hamburger"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" />
          </button>
          <div className="admin-topbar__title">
            <h1>{meta.title}</h1>
            <span className="bc">{meta.crumb}</span>
          </div>

          <div className="admin-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="Search users…"
              aria-label="Search users"
              onKeyDown={onSearch}
            />
          </div>

          <button
            className="admin-icon-btn"
            onClick={toggleTheme}
            aria-label="Toggle light or dark theme"
            title="Toggle theme"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <Link className="admin-icon-btn" href="/admin/deposits" aria-label="Pending approvals">
            <span style={{ position: "relative", display: "inline-grid" }}>
              <Icon name="bell" />
              {(badges.deposits ?? 0) + (badges.withdrawals ?? 0) ? (
                <span
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--admin-neg)",
                  }}
                />
              ) : null}
            </span>
          </Link>
        </header>

        <main className="admin-view">{children}</main>
      </div>
    </div>
  );
}
