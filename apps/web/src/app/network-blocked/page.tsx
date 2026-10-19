import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { VPN_BLOCKED_MESSAGE } from "@/lib/network-guard/guard";

export const metadata: Metadata = {
  title: "Show your IP address",
  robots: { index: false, follow: false },
};

export default function NetworkBlockedPage() {
  return (
    <AuthShell
      eyebrow="Connection blocked"
      title="Show your IP address."
      subtitle={VPN_BLOCKED_MESSAGE}
      imageCaption="Every tick settles on a real ledger."
      footer={
        <>Using a work VPN you can&apos;t switch off? Contact support from a normal connection and we can allow your account.</>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-ink-2">
        <p>
          To protect accounts and keep bonuses fair, we only accept connections that show your real
          IP address — no VPNs, proxies, iCloud Private Relay, Tor or cloud servers.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b className="text-ink">iPhone / iPad (Safari):</b> tap <b className="text-ink">aA</b> in the
            address bar → <b className="text-ink">Show IP Address</b>, or turn off Settings → your
            name → iCloud → Private Relay.
          </li>
          <li>
            <b className="text-ink">VPN or WARP app:</b> switch it off.
          </li>
        </ul>
        <p>Then press retry.</p>
        <Link
          href="/trade"
          className="mt-1 inline-flex h-12 items-center justify-center rounded-full bg-brand-fill text-sm font-black text-white transition hover:bg-brand-fill-hi"
        >
          Retry <span aria-hidden>→</span>
        </Link>
      </div>
    </AuthShell>
  );
}
