import {
  BONUS_TIERS,
  DEPOSIT_TTL_MINUTES,
  MAX_DEPOSIT_USD_MINOR,
  MIN_DEPOSIT_USD_MINOR,
  TURNOVER_MULTIPLE,
  USD_INR_RATE,
  convertMinorBetween,
  prisma,
} from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { upiCollection } from "@/lib/upi-collection";
import { Card, PageHead, Pill } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { num, inrFromMinor, usdFromMinor } from "../../_lib/format";

export const dynamic = "force-dynamic";

type ReactNode = React.ReactNode;

function Row({ label, desc, control }: { label: string; desc?: string; control: ReactNode }) {
  return (
    <div className="admin-set-row">
      <div>
        <div className="lbl">{label}</div>
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      <div style={{ flex: "none", fontWeight: 700, textAlign: "right" }}>{control}</div>
    </div>
  );
}

export default async function SettingsPage() {
  await requireAdmin();

  const [userCount, assetCount, auditCount] = await Promise.all([
    prisma.user.count(),
    prisma.asset.count(),
    prisma.auditLog.count(),
  ]);

  // Deposit limits are stored in USD minor units; show them in USD and give
  // the rupee equivalent at the reservation rate.
  const minInr = convertMinorBetween(MIN_DEPOSIT_USD_MINOR, "USD", "INR");
  const maxInr = convertMinorBetween(MAX_DEPOSIT_USD_MINOR, "USD", "INR");

  return (
    <>
      <PageHead
        title="Settings"
        desc="Read-only. Platform values come from the deposit and bonus engine and change with a release; collection accounts come from the environment."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
        <Card title="Platform">
          <Row label="Platform name" control="IndianxTrade" />
          <Row label="USD → INR rate" desc="The one fixed rate: deposits, currency switch and derived limits." control={`₹${USD_INR_RATE}`} />
          <Row
            label="Deposit range"
            desc={`Per deposit · about ${inrFromMinor(minInr, 0)} – ${inrFromMinor(maxInr, 0)} at this rate.`}
            control={`${usdFromMinor(MIN_DEPOSIT_USD_MINOR, 0)} – ${usdFromMinor(MAX_DEPOSIT_USD_MINOR, 0)}`}
          />
          <Row label="Deposit hold window" desc="How long a reserved amount stays valid." control={`${DEPOSIT_TTL_MINUTES} min`} />
          <Row
            label="Deposit bonus"
            desc="1st, 2nd, 3rd and 4th deposit; none after."
            control={BONUS_TIERS.map((t) => `${t}%`).join(" · ")}
          />
          <Row label="Bonus turnover" desc="Wagering required before a bonus converts." control={`${TURNOVER_MULTIPLE}×`} />
          <Row
            label="Settlement UPI IDs"
            desc="Set with UPI_COLLECTION_VPAS."
            control={<span className="mono">{upiCollection().vpas.join(", ")}</span>}
          />
        </Card>

        <Card title="Security">
          <Row
            label="Console access"
            desc="One shared operator secret, separate from user accounts."
            control={<Pill tone="pos">Shared secret</Pill>}
          />
          <Row label="Session length" desc="Sessions end automatically." control="24 hours" />
          <Row
            label="Audit trail"
            desc="Every change writes an append-only entry."
            control={<Pill tone="pos">On</Pill>}
          />
          <Row
            label="Sign out of this console"
            control={
              <a href="/api/admin/logout" className="admin-btn admin-btn--sm admin-btn--danger">
                <Icon name="logout" size={14} />
                Sign out
              </a>
            }
          />
        </Card>

        <Card title="Data">
          <Row label="Accounts" desc="Including affiliates." control={num(userCount)} />
          <Row label="Markets" control={num(assetCount)} />
          <Row label="Audit entries" control={num(auditCount)} />
        </Card>
      </div>
    </>
  );
}
