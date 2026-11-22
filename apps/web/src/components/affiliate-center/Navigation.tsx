"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { LogoWordmark } from "@/components/brand/Logo";
import { Icon, type IconName } from "@/components/shell/Icon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SITE_NAME } from "@/lib/site";
import { CENTER_PATH } from "./presentation";
import styles from "./center.module.css";

const NAVIGATION: { href: string; label: string; icon: IconName }[] = [
  { href: CENTER_PATH, label: "Dashboard", icon: "candles" },
  { href: `${CENTER_PATH}/statistics`, label: "Statistics", icon: "trade" },
  { href: `${CENTER_PATH}/links`, label: "Links", icon: "globe" },
  { href: `${CENTER_PATH}/levels`, label: "Levels", icon: "cup" },
  { href: `${CENTER_PATH}/withdrawal`, label: "Withdrawal", icon: "wallet" },
  { href: `${CENTER_PATH}/faq`, label: "FAQ", icon: "help" },
  { href: "/support", label: "Support", icon: "shield" },
  { href: "/account", label: "My Account", icon: "user" },
];

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className={styles.navigation} aria-label="Affiliate Center">
      <div className={styles.navMain}>
        {NAVIGATION.map(({ href, label, icon }) => (
          <Link key={href} href={href} {...(onNavigate ? { onClick: onNavigate } : {})} aria-current={pathname === href ? "page" : undefined}>
            <Icon name={icon} />
            {label}
          </Link>
        ))}
      </div>
      <Link href="/trade" {...(onNavigate ? { onClick: onNavigate } : {})} className={styles.backLink}>
        <Icon name="back" />
        Back to trading
      </Link>
    </nav>
  );
}

function BrandLockup({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href={CENTER_PATH} {...(onNavigate ? { onClick: onNavigate } : {})} className={styles.brand} aria-label={`${SITE_NAME} Affiliate Center`}>
      <LogoWordmark compact className="h-[25px] max-w-full object-contain object-left" />
      <span>Affiliate Center</span>
    </Link>
  );
}

export function CenterSidebar() {
  return (
    <aside className={styles.sidebar}>
      <BrandLockup />
      <NavigationLinks />
    </aside>
  );
}

export function CenterMobileNavigation() {
  const drawer = useRef<HTMLDialogElement>(null);
  function close() {
    drawer.current?.close();
  }
  return (
    <div className={styles.mobileNavigation}>
      <button type="button" className={styles.iconButton} aria-label="Open Affiliate Center menu" onClick={() => drawer.current?.showModal()}>
        <Icon name="menu" />
      </button>
      <Link href={CENTER_PATH} className="truncate font-semibold">Affiliate Center</Link>
      <dialog
        ref={drawer}
        className={styles.drawer}
        aria-label="Affiliate Center menu"
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <div className={styles.drawerContent}>
          <div className={styles.drawerHeading}>
            <BrandLockup onNavigate={close} />
            <button type="button" className={styles.iconButton} aria-label="Close menu" onClick={close}><Icon name="close" /></button>
          </div>
          <NavigationLinks onNavigate={close} />
        </div>
      </dialog>
    </div>
  );
}

export function LevelPopoverLink() {
  return (
    <Link href={`${CENTER_PATH}/levels`} className={styles.textLink}
      onClick={() => document.getElementById("affiliate-level-popover")?.hidePopover()}>
      View levels <Icon name="chevron" className="size-4" />
    </Link>
  );
}

export function CenterHeaderActions({ email, shortId, children }: { email: string; shortId: string; children: ReactNode }) {
  const account = useRef<HTMLDivElement>(null);
  function closeAccount() {
    account.current?.hidePopover();
  }
  async function signOut(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok) {
        window.location.assign("/affiliate/login");
        return;
      }
    } catch {
      // The native form below can still attempt to end this session.
    }
    form.submit();
  }

  return (
    <>
      <div className={styles.levelControl}>{children}</div>
      <div className={styles.preferences}>
        <ThemeToggle />
        <div className={styles.accountControl}>
          <button type="button" popoverTarget="affiliate-account" className={styles.iconButton} aria-label="Account menu">
            <Icon name="user" />
          </button>
          <div id="affiliate-account" ref={account} popover="auto" className={styles.accountPopover}>
            <div className={styles.accountIdentity}>
              <strong>{email}</strong>
              <span>Account ID {shortId}</span>
            </div>
            <Link href={`${CENTER_PATH}/withdrawal`} onClick={closeAccount}><Icon name="wallet" />Withdrawal</Link>
            <Link href="/account" onClick={closeAccount}><Icon name="user" />My Account</Link>
            <form action="/api/auth/logout" method="post" onSubmit={(event) => void signOut(event)}>
              <button type="submit"><Icon name="logout" />Sign out</button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
