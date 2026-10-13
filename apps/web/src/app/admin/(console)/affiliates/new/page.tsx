import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { PasswordField } from "../../../_components/PasswordField";
import { Notice, PageHead } from "../../../_components/ui";
import { Icon, type IconName } from "../../../_lib/icons";
import { createAffiliateAction } from "../actions";

export const dynamic = "force-dynamic";

const GETS: { icon: IconName; title: string; sub: string }[] = [
  { icon: "dollar", title: "₹10,000 live + ₹10,000 demo", sub: "Float for showing real trades on stream" },
  { icon: "clock", title: "Resets daily at 00:00 IST", sub: "Both balances go back to ₹10,000" },
  { icon: "shield", title: "No real money moves", sub: "Their deposits and withdrawals display but never settle" },
];

export default async function NewAffiliatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  return (
    <>
      <PageHead
        title="New affiliate"
        desc="Create a streamer account and share the sign-in with them."
        back={{ href: "/admin/affiliates", label: "Affiliates" }}
      />

      {sp.error ? <Notice tone="neg">{sp.error}</Notice> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start", maxWidth: 980 }}>
        <form action={createAffiliateAction} className="admin-card" style={{ flex: "999 1 420px", minWidth: 0, padding: 22 }}>
          <div className="admin-field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" name="email" required autoComplete="off" className="admin-input" placeholder="streamer@example.in" />
          </div>
          <div className="admin-field">
            <label htmlFor="nickname">
              Display name{" "}
              <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--admin-faint)", fontWeight: 500 }}>
                · optional
              </span>
            </label>
            <input id="nickname" type="text" name="nickname" autoComplete="off" className="admin-input" placeholder="e.g. StreetTrader" />
          </div>
          <div className="admin-field">
            <label htmlFor="password">Password</label>
            <PasswordField id="password" name="password" />
            <span className="admin-cell-sub">
              At least 8 characters. Shown in plain text so you can share it. If it doesn&rsquo;t work at sign-in, use
              Reset password on the list.
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--admin-border-soft)", paddingTop: 18, marginTop: 4 }}>
            <Link href="/admin/affiliates" className="admin-btn admin-btn--ghost">
              Cancel
            </Link>
            <button type="submit" className="admin-btn admin-btn--primary">
              Create affiliate
            </button>
          </div>
        </form>

        <aside className="admin-card" style={{ flex: "1 1 280px", minWidth: 0, padding: 22 }} aria-label="What the affiliate gets">
          <div className="admin-label" style={{ marginBottom: 16 }}>
            What they get
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            {GETS.map((g) => (
              <li key={g.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: "var(--admin-accent-soft)",
                    color: "var(--admin-accent-ink)",
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                  }}
                >
                  <Icon name={g.icon} size={16} />
                </span>
                <div>
                  <div style={{ fontWeight: 600 }}>{g.title}</div>
                  <div className="admin-cell-sub">{g.sub}</div>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
