import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { MAINTENANCE_MESSAGE } from "@/lib/maintenance";

export const metadata: Metadata = {
  title: "Under maintenance",
  robots: { index: false, follow: false },
};

/**
 * Shown for every user-facing path while MAINTENANCE_MODE is on. The proxy
 * rewrites to it rather than redirecting, so the visitor keeps the URL they
 * asked for and lands back on it when they retry.
 *
 * No automatic refresh: a page that reloads itself every few seconds against
 * a site that is deliberately down just adds load to the thing being worked
 * on. The visitor decides when to retry.
 */
export default function MaintenancePage() {
  return (
    <AuthShell
      eyebrow="Scheduled maintenance"
      title="We'll be right back."
      subtitle={MAINTENANCE_MESSAGE}
      imageCaption="Every tick settles on a real ledger."
      legal={null}
      footer={<>Need something urgently? Reach support and we&apos;ll pick it up as soon as we&apos;re back.</>}
    >
      <div className="flex flex-col gap-4 text-sm text-ink-2">
        <p>
          We&apos;re updating the price engine. Your balance, your open positions and your
          history are all safe — nothing is being changed about your account.
        </p>
        <p>This usually takes a few minutes. Thanks for your patience.</p>
      </div>
    </AuthShell>
  );
}
