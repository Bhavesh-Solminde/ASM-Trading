import Link from "next/link";
import {
  BONUS_PERCENT,
  DEMO_VPA,
  DEPOSIT_TTL_MINUTES,
  MAX_DEPOSIT_USD_MINOR,
  MIN_DEPOSIT_USD_MINOR,
  TURNOVER_MULTIPLE,
  USD_TO_INR_RATE,
  prisma,
} from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Card } from "../../_components/ui";
import { ThemeControl } from "../../_components/ThemeControl";
import { Icon } from "../../_lib/icons";
import { num, usdFromMinor } from "../../_lib/format";

export const dynamic = "force-dynamic";

const TABS = [
  ["general", "Platform"],
  ["appearance", "Appearance"],
  ["security", "Security"],
  ["about", "Data & about"],
] as const;

type ReactNode = React.ReactNode;

function Row({ label, desc, control }: { label: string; desc?: string; control: ReactNode }) {
  return (
    <div className="admin-set-row">
      <div>
        <div className="lbl">{label}</div>
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      <div style={{ flex: "none" }}>{control}</div>
    </div>
  );
}

const mono = (v: ReactNode) => (
  <span className="mono" style={{ fontWeight: 600 }}>
    {v}
  </span>
);

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.some((t) => t[0] === sp.tab) ? sp.tab! : "general";

  const [userCount, assetCount, auditCount] = await Promise.all([
    prisma.user.count(),
    prisma.asset.count(),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="admin-settings-grid">
      <div className="admin-set-nav">
        {TABS.map(([id, label]) => (
          <Link key={id} href={`/admin/settings?tab=${id}`} className={tab === id ? "active" : ""}>
            {label}
          </Link>
        ))}
      </div>

      <div>
        {tab === "general" ? (
          <Card title="Platform parameters" sub="Live operating constants from the deposit & bonus engine.">
            <Row label="Platform name" control={mono("ASM Trading")} />
            <Row
              label="USD → INR rate"
              desc="Rate applied when reserving a deposit amount."
              control={mono(`₹${USD_TO_INR_RATE}`)}
            />
            <Row
              label="Deposit range"
              desc="Minimum and maximum per deposit."
              control={mono(`${usdFromMinor(MIN_DEPOSIT_USD_MINOR, 0)} – ${usdFromMinor(MAX_DEPOSIT_USD_MINOR, 0)}`)}
            />
            <Row
              label="Deposit hold window"
              desc="How long a reserved amount stays live."
              control={mono(`${DEPOSIT_TTL_MINUTES} min`)}
            />
            <Row label="First-deposit bonus" control={mono(`${BONUS_PERCENT}%`)} />
            <Row
              label="Bonus turnover multiple"
              desc="Wagering required before a bonus converts."
              control={mono(`${TURNOVER_MULTIPLE}×`)}
            />
            <Row label="Settlement VPA" control={mono(DEMO_VPA)} />
          </Card>
        ) : null}

        {tab === "appearance" ? (
          <Card title="Appearance" sub="Theme is scoped to the admin console and remembered on this device.">
            <Row
              label="Console theme"
              desc="Switch between the light back-office and dark terminal look."
              control={<ThemeControl />}
            />
            <Row
              label="Density"
              desc="Comfortable spacing is used across the console."
              control={mono("Comfortable")}
            />
          </Card>
        ) : null}

        {tab === "security" ? (
          <Card title="Security" sub="Access to this console is independent of any user account.">
            <Row
              label="Access model"
              desc="Gated by a single shared secret (ADMIN_PANEL_SECRET), not a user role."
              control={<span className="admin-pill admin-pill--pos">Shared secret</span>}
            />
            <Row label="Session lifetime" desc="Admin sessions expire automatically." control={mono("24 hours")} />
            <Row
              label="Audit trail"
              desc="Every mutating action writes an append-only audit entry."
              control={<span className="admin-pill admin-pill--pos">Enabled</span>}
            />
            <Row
              label="End session"
              control={
                <a href="/api/admin/logout" className="admin-btn admin-btn--sm admin-btn--danger">
                  <Icon name="logout" size={14} />
                  Sign out
                </a>
              }
            />
          </Card>
        ) : null}

        {tab === "about" ? (
          <Card title="Data & about" sub="This console reads and writes the live platform database.">
            <Row label="Registered users" control={mono(num(userCount))} />
            <Row label="Configured markets" control={mono(num(assetCount))} />
            <Row label="Audit log entries" control={mono(num(auditCount))} />
            <div className="admin-set-row">
              <div>
                <div className="lbl">Stack</div>
                <div className="desc">Next.js server components + Prisma/PostgreSQL, Redis-backed admin sessions.</div>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
