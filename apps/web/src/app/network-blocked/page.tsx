import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { VPN_BLOCKED_MESSAGE } from "@/lib/network-guard/guard";

export const metadata: Metadata = {
  title: "Turn off your VPN",
  robots: { index: false, follow: false },
};

export default function NetworkBlockedPage() {
  return (
    <AuthShell
      eyebrow="Connection blocked"
      title="Turn off your VPN."
      subtitle={VPN_BLOCKED_MESSAGE}
      imageCaption="Every tick settles on a real ledger."
      footer={
        <>Using a work VPN you can&apos;t switch off? Contact support from a normal connection and we can allow your account.</>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-ink-2">
        <p>
          To protect accounts and keep bonuses fair, ASM doesn&apos;t accept connections from VPNs,
          proxies, Tor or cloud servers.
        </p>
        <p>Switch off the VPN or proxy app, then press retry.</p>
        <Link
          href="/trade"
          className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-brand text-sm font-black text-brand-ink transition hover:brightness-110"
        >
          Retry <span aria-hidden>→</span>
        </Link>
      </div>
    </AuthShell>
  );
}
