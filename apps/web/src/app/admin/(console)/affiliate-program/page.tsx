import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  ProgramSettingKey,
  listAffiliatesForAdmin,
  listEarningsForReview,
  listProgramSettingHistory,
  listProgramWithdrawalsForAdmin,
  prisma,
  type AffiliateStatus,
  type ProgramWithdrawalStatus,
} from "@asm/db";
import { PAYOUT_METHOD_LABEL, USDT_NETWORK_INFO, isUsdtNetwork } from "@asm/contracts";
import { requireAdmin } from "@/lib/admin-auth";
import { Icon } from "../../_lib/icons";
import { TableControls } from "../../_components/TableControls";
import { Card, EmptyRow, Notice, PageHead, Pager, Pill, StatusPill, TabBar, Tag } from "../../_components/ui";
import { hrefWith, inrFromMinor, num } from "../../_lib/format";
import {
  approveProgramWithdrawalAction,
  clearNeedsReviewAction,
  createProgramAdjustmentAction,
  markProgramWithdrawalPaidAction,
  rejectProgramWithdrawalAction,
  releaseHeldEarningAction,
  scheduleSettingAction,
  voidHeldEarningAction,
} from "./actions";
import { AffiliateStatusPill, ReasonForm, bpsPct } from "./program-ui";
import { SETTING_META, fmtIst, formatSettingValue } from "./parse";

export const dynamic = "force-dynamic";

const PATH = "/admin/affiliate-program";
type Tab = "withdrawals" | "affiliates" | "review" | "settings";
const TABS: Tab[] = ["withdrawals", "affiliates", "review", "settings"];
const W_STATUSES: ProgramWithdrawalStatus[] = ["REQUESTED", "APPROVED", "PAID", "REJECTED", "CANCELLED"];
const A_STATUSES: AffiliateStatus[] = ["PENDING_VERIFICATION", "PENDING_APPROVAL", "ACTIVE", "SUSPENDED"];
const KIND_LABEL: Record<string, string> = {
  REFERRAL_REWARD: "Referral reward",
  AFFILIATE_DEPOSIT_REWARD: "Deposit reward",
  REVENUE_SHARE: "Revenue Share",
  ADJUSTMENT: "Adjustment",
};

type SP = Record<string, string | undefined>;

export default async function AffiliateProgramPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "withdrawals";

  const [requested, approved, held, needsReview, pendingApproval] = await Promise.all([
    prisma.programWithdrawal.count({ where: { status: "REQUESTED" } }),
    prisma.programWithdrawal.count({ where: { status: "APPROVED" } }),
    prisma.programEarning.count({ where: { status: "HELD" } }),
    prisma.programEarning.count({ where: { needsReview: true } }),
    prisma.affiliateProfile.count({ where: { status: "PENDING_APPROVAL", user: { legacySimulated: false } } }),
  ]);

  const tabHref = (key: Tab) => hrefWith(PATH, {}, { tab: key === "withdrawals" ? null : key });

  return (
    <>
      <PageHead
        title="Affiliate program"
        desc="Program withdrawals, affiliates and their rates, held earnings, and program settings. All amounts are in INR; times are IST. Every action needs a reason and is audit-logged."
      />
      {sp.error ? <Notice tone="neg">{sp.error}</Notice> : sp.ok ? <Notice tone="pos">{sp.ok}</Notice> : null}

      <section className="admin-card">
        <TabBar
          label="Affiliate program views"
          active={tab}
          tabs={[
            { key: "withdrawals", label: "Withdrawals", href: tabHref("withdrawals"), count: requested + approved },
            { key: "affiliates", label: "Affiliates", href: tabHref("affiliates"), count: pendingApproval },
            { key: "review", label: "Earnings review", href: tabHref("review"), count: held + needsReview },
            { key: "settings", label: "Settings", href: tabHref("settings") },
          ]}
        />
        {tab === "withdrawals" ? <WithdrawalsTab sp={sp} /> : null}
        {tab === "affiliates" ? <AffiliatesTab sp={sp} /> : null}
        {tab === "review" ? <ReviewTab sp={sp} /> : null}
        {tab === "settings" ? <SettingsTab /> : null}
      </section>

      {tab === "review" ? <AdjustmentCard /> : null}
      {tab === "settings" ? <ScheduleCard /> : null}
    </>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-cell-sub" style={{ padding: "12px 18px", borderBottom: "1px solid var(--admin-border)" }}>
      {children}
    </div>
  );
}

function SrOnly({ children }: { children: React.ReactNode }) {
  return <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{children}</span>;
}

/* -------------------------------- Withdrawals ------------------------------- */

async function WithdrawalsTab({ sp }: { sp: SP }) {
  const status = W_STATUSES.includes(sp.status as ProgramWithdrawalStatus)
    ? (sp.status as ProgramWithdrawalStatus)
    : sp.status === "all"
      ? undefined
      : "REQUESTED";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listProgramWithdrawalsForAdmin({ ...(status ? { status } : {}), page });
  const spForLinks: SP = { tab: "withdrawals", status: sp.status };

  const chip = (value: string, label: string) => (
    <Link
      key={value}
      href={hrefWith(PATH, { tab: "withdrawals" }, { status: value === "REQUESTED" ? null : value })}
      className={`admin-chip${(status ?? "all") === value ? " active" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <Hint>
        Approve first, then send the money and mark it paid with the payment reference. Approval alone is not payment. Rejecting
        returns the amount to the user&rsquo;s available balance and shows them the reason.
      </Hint>
      <div className="admin-toolbar">
        {chip("REQUESTED", "To approve")}
        {chip("APPROVED", "To pay")}
        {chip("PAID", "Paid")}
        {chip("REJECTED", "Rejected")}
        {chip("CANCELLED", "Cancelled")}
        {chip("all", "All")}
        <span className="admin-result-count">{status === "REQUESTED" || status === "APPROVED" ? "Oldest first" : "Newest first"}</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--stack">
          <thead>
            <tr>
              <th>User</th>
              <th className="admin-num-right">Amount</th>
              <th>Pay to</th>
              <th>Requested</th>
              <th>Status</th>
              <th className="admin-num-right">
                <SrOnly>Actions</SrOnly>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow cols={6} message="No program withdrawals here." />
            ) : (
              rows.map((w) => (
                <tr key={w.id}>
                  <td>
                    <div className="admin-cell-strong" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link className="admin-link" href={`/admin/users/${w.user.id}`}>
                        {w.user.email}
                      </Link>
                      {w.user.role === "AFFILIATE" ? <Tag accent>Affiliate</Tag> : null}
                    </div>
                    <Pill tone={w.user.kycStatus === "VERIFIED" ? "pos" : "warn"}>KYC {w.user.kycStatus.toLowerCase().replace("_", " ")}</Pill>
                  </td>
                  <td className="admin-num-right admin-amount">{inrFromMinor(w.amountMinor)}</td>
                  <td style={{ minWidth: 220 }}>
                    <PayoutCell w={w} />
                  </td>
                  <td className="admin-cell-sub">{fmtIst(w.createdAt)}</td>
                  <td>
                    <StatusPill status={w.status} />
                    {w.reason ? <div className="admin-cell-sub">{w.reason}</div> : null}
                    {w.paymentReference ? <div className="admin-cell-sub mono">Ref {w.paymentReference}</div> : null}
                  </td>
                  <td className="admin-num-right">
                    {w.status === "REQUESTED" || w.status === "APPROVED" ? (
                      <div className="admin-row-actions">
                        <ReasonForm
                          action={rejectProgramWithdrawalAction}
                          hidden={{ withdrawalId: w.id }}
                          button="Reject"
                          tone="danger"
                          field="reason"
                          label="Reason shown to the user"
                          submit="Reject and return funds"
                        />
                        {w.status === "REQUESTED" ? (
                          <form action={approveProgramWithdrawalAction}>
                            <input type="hidden" name="withdrawalId" value={w.id} />
                            <button type="submit" className="admin-btn admin-btn--sm admin-btn--pos">
                              Approve
                            </button>
                          </form>
                        ) : (
                          <ReasonForm
                            action={markProgramWithdrawalPaidAction}
                            hidden={{ withdrawalId: w.id }}
                            button="Mark paid"
                            tone="pos"
                            field="paymentReference"
                            label="Payment reference (UTR / tx hash)"
                            submit="Mark paid"
                          />
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager total={total} page={page} perPage={pageSize} path={PATH} sp={spForLinks} />
    </>
  );
}

type PayoutRow = {
  method: string;
  accountHolder: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  usdtNetwork: string | null;
  usdtAddress: string | null;
  destinationKey: string | null;
  sharedDestinationUserCount?: number;
};

function PayoutCell({ w }: { w: PayoutRow }) {
  const label = PAYOUT_METHOD_LABEL[w.method as keyof typeof PAYOUT_METHOD_LABEL] ?? w.method;
  const line = (k: string, v: string | null) =>
    v ? (
      <div>
        <span className="admin-cell-sub">{k} </span>
        <span className="mono" style={{ userSelect: "all", wordBreak: "break-all" }}>
          {v}
        </span>
      </div>
    ) : null;
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div className="admin-cell-strong">{label}</div>
      {w.method === "BANK" ? (
        <>
          {line("Name", w.accountHolder)}
          {line("A/c", w.accountNumber)}
          {line("IFSC", w.ifsc)}
        </>
      ) : null}
      {w.method === "UPI" ? line("UPI", w.upiId) : null}
      {w.method === "USDT" ? (
        <>
          {line("Net", isUsdtNetwork(w.usdtNetwork) ? USDT_NETWORK_INFO[w.usdtNetwork].shortLabel : w.usdtNetwork)}
          {line("To", w.usdtAddress)}
        </>
      ) : null}
      {line("Key", w.destinationKey)}
      {w.sharedDestinationUserCount ? (
        <span className="admin-kyc-warn" style={{ color: "var(--admin-neg)" }}>
          <Icon name="alert" size={13} />
          Also used by {w.sharedDestinationUserCount === 1 ? "another account" : `${w.sharedDestinationUserCount} other accounts`}
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------- Affiliates -------------------------------- */

async function AffiliatesTab({ sp }: { sp: SP }) {
  const status = A_STATUSES.includes(sp.status as AffiliateStatus) ? (sp.status as AffiliateStatus) : undefined;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listAffiliatesForAdmin({ ...(status ? { status } : {}), ...(q ? { q } : {}), page });
  const spForLinks: SP = { tab: "affiliates", status, q };

  return (
    <>
      <div className="admin-toolbar">
        <TableControls
          placeholder="Search email, name or user ID"
          filters={[
            {
              param: "status",
              label: "Status",
              options: [
                { value: "all", label: "All statuses" },
                { value: "PENDING_APPROVAL", label: "Awaiting approval" },
                { value: "ACTIVE", label: "Active" },
                { value: "SUSPENDED", label: "Suspended" },
                { value: "PENDING_VERIFICATION", label: "Email unverified" },
              ],
            },
          ]}
        />
        <span className="admin-result-count">{num(total)} affiliates</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--stack">
          <thead>
            <tr>
              <th>Affiliate</th>
              <th>Status</th>
              <th className="admin-num-right">Referrals</th>
              <th className="admin-num-right">Deposited</th>
              <th className="admin-num-right">Revenue Share</th>
              <th className="admin-num-right">Pending / held</th>
              <th className="admin-num-right">Available</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow cols={7} message={q || status ? "No affiliates match." : "No affiliates yet."} />
            ) : (
              rows.map((a) => (
                <tr key={a.userId}>
                  <td>
                    <Link className="admin-link admin-cell-strong" href={`${PATH}/affiliates/${a.userId}`}>
                      {a.name ?? a.email}
                    </Link>
                    <div className="admin-cell-sub">{a.email}</div>
                    {a.openSelfReferralFlags ? (
                      <Pill tone="warn">
                        {a.openSelfReferralFlags} self-referral flag{a.openSelfReferralFlags === 1 ? "" : "s"}
                      </Pill>
                    ) : null}
                  </td>
                  <td>
                    <AffiliateStatusPill status={a.status} />
                    <div className="admin-cell-sub">KYC {a.kycStatus.toLowerCase().replace("_", " ")}</div>
                  </td>
                  <td className="admin-num-right">
                    {num(a.qualifiedReferrals)} <span className="admin-cell-sub">/ {num(a.totalReferrals)}</span>
                  </td>
                  <td className="admin-num-right admin-amount">{inrFromMinor(a.totalDepositedMinor)}</td>
                  <td className="admin-num-right">{a.currentRate ? bpsPct(a.currentRate.revenueShareBps) : <span className="admin-cell-sub">0% (none)</span>}</td>
                  <td className="admin-num-right">
                    {inrFromMinor(a.earnings.PENDING)} <span className="admin-cell-sub">/ {inrFromMinor(a.earnings.HELD)}</span>
                  </td>
                  <td className="admin-num-right admin-amount">{inrFromMinor(a.wallet?.availableMinor ?? 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager total={total} page={page} perPage={pageSize} path={PATH} sp={spForLinks} />
    </>
  );
}

/* ------------------------------ Earnings review ----------------------------- */

async function ReviewTab({ sp }: { sp: SP }) {
  const filter = sp.filter === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "HELD";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listEarningsForReview({ filter, page });
  const spForLinks: SP = { tab: "review", filter: sp.filter };

  const chip = (value: "HELD" | "NEEDS_REVIEW", label: string) => (
    <Link
      key={value}
      href={hrefWith(PATH, { tab: "review" }, { filter: value === "HELD" ? null : value })}
      className={`admin-chip${filter === value ? " active" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <Hint>
        Releasing a held earning makes it pending; it becomes available at the next daily close. Voiding means it is never paid.
        Clearing a review flag moves no money; correct the balance with an adjustment if needed.
      </Hint>
      <div className="admin-toolbar">
        {chip("HELD", "Held")}
        {chip("NEEDS_REVIEW", "Needs review")}
        <span className="admin-result-count">Oldest first</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--stack">
          <thead>
            <tr>
              <th>Beneficiary</th>
              <th>Kind</th>
              <th className="admin-num-right">Amount</th>
              <th>Earned</th>
              <th>Why</th>
              <th className="admin-num-right">
                <SrOnly>Actions</SrOnly>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow cols={6} message={filter === "HELD" ? "No held earnings." : "No earnings flagged for review."} />
            ) : (
              rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link
                      className="admin-link"
                      href={e.beneficiary.role === "AFFILIATE" ? `${PATH}/affiliates/${e.beneficiaryUserId}` : `/admin/users/${e.beneficiaryUserId}`}
                    >
                      {e.beneficiary.email}
                    </Link>
                    {e.beneficiary.role === "AFFILIATE" ? (
                      <div>
                        <Tag accent>Affiliate</Tag>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {KIND_LABEL[e.kind] ?? e.kind}
                    <div>
                      <StatusPill status={e.status} />
                    </div>
                  </td>
                  <td className="admin-num-right admin-amount">{inrFromMinor(e.amountMinor)}</td>
                  <td className="admin-cell-sub">{fmtIst(e.earnedAt)}</td>
                  <td className="admin-cell-sub">{e.holdReason ?? e.note ?? (e.needsReview ? "Qualifying deposit reversed" : "—")}</td>
                  <td className="admin-num-right">
                    <div className="admin-row-actions">
                      {e.status === "HELD" ? (
                        <>
                          <ReasonForm
                            action={voidHeldEarningAction}
                            hidden={{ earningId: e.id }}
                            button="Void"
                            tone="danger"
                            field="reason"
                            label="Reason"
                            submit="Void earning"
                          />
                          <ReasonForm
                            action={releaseHeldEarningAction}
                            hidden={{ earningId: e.id }}
                            button="Release"
                            tone="pos"
                            field="note"
                            label="Note"
                            submit="Release"
                          />
                        </>
                      ) : null}
                      {e.needsReview ? (
                        <ReasonForm
                          action={clearNeedsReviewAction}
                          hidden={{ earningId: e.id }}
                          button="Clear review"
                          tone="ghost"
                          field="note"
                          label="Note"
                          submit="Clear flag"
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager total={total} page={page} perPage={pageSize} path={PATH} sp={spForLinks} />
    </>
  );
}

function AdjustmentCard() {
  return (
    <Card title="Manual adjustment" sub="Adds to or takes from a user's available program balance at once. A deduction can't go below zero.">
      <form action={createProgramAdjustmentAction} className="admin-grid admin-cols-3" style={{ alignItems: "end" }}>
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <div className="admin-field" style={{ marginBottom: 0 }}>
          <label htmlFor="adj-user">User ID or email</label>
          <input id="adj-user" name="user" className="admin-input" required autoComplete="off" />
        </div>
        <div className="admin-field" style={{ marginBottom: 0 }}>
          <label htmlFor="adj-amount">Amount (₹, use − to deduct)</label>
          <input id="adj-amount" name="amount" className="admin-input" required inputMode="decimal" placeholder="250 or -99.50" pattern="[+\-]?[0-9,]+(\.[0-9]{1,2})?" />
        </div>
        <div className="admin-field" style={{ marginBottom: 0 }}>
          <label htmlFor="adj-reason">Reason</label>
          <input id="adj-reason" name="reason" className="admin-input" required maxLength={500} />
        </div>
        <div>
          <button type="submit" className="admin-btn admin-btn--primary">
            Record adjustment
          </button>
        </div>
      </form>
    </Card>
  );
}

/* --------------------------------- Settings --------------------------------- */

const KEYS = Object.values(ProgramSettingKey);

async function SettingsTab() {
  const now = new Date();
  const history = await listProgramSettingHistory(now);
  const current = new Map(history.filter((h) => h.inForce).map((h) => [h.key, h]));
  const scheduled = history.filter((h) => h.effectiveFrom > now);

  return (
    <>
      <Hint>
        A new value applies from its effective time onward. Past earnings and qualifications keep the values in force when they
        happened.
      </Hint>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--stack">
          <thead>
            <tr>
              <th>Setting</th>
              <th className="admin-num-right">In force</th>
              <th>Since</th>
              <th>Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {KEYS.map((key) => {
              const cur = current.get(key);
              const next = scheduled.filter((s) => s.key === key);
              return (
                <tr key={key}>
                  <td>
                    <div className="admin-cell-strong">{SETTING_META[key]?.label ?? key}</div>
                    <div className="admin-cell-sub">{SETTING_META[key]?.help}</div>
                  </td>
                  <td className="admin-num-right admin-amount">{cur ? formatSettingValue(key, cur.value) : "—"}</td>
                  <td className="admin-cell-sub">{cur ? (cur.effectiveFrom.getTime() === 0 ? "Launch" : fmtIst(cur.effectiveFrom)) : "—"}</td>
                  <td className="admin-cell-sub">
                    {next.length
                      ? next.map((s) => (
                          <div key={s.id}>
                            {formatSettingValue(key, s.value)} from {fmtIst(s.effectiveFrom)}
                          </div>
                        ))
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-card__head" style={{ borderTop: "1px solid var(--admin-border)" }}>
        <div>
          <h3>Version history</h3>
          <div className="sub">Every value ever scheduled, newest first per setting</div>
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--stack">
          <thead>
            <tr>
              <th>Setting</th>
              <th className="admin-num-right">Value</th>
              <th>Effective from</th>
              <th>By</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>
                  {SETTING_META[h.key]?.label ?? h.key}
                  {h.inForce ? (
                    <>
                      {" "}
                      <Pill tone="pos">In force</Pill>
                    </>
                  ) : h.effectiveFrom > now ? (
                    <>
                      {" "}
                      <Pill tone="info">Scheduled</Pill>
                    </>
                  ) : null}
                </td>
                <td className="admin-num-right admin-amount">{formatSettingValue(h.key, h.value)}</td>
                <td className="admin-cell-sub">{h.effectiveFrom.getTime() === 0 ? "Launch" : fmtIst(h.effectiveFrom)}</td>
                <td className="admin-cell-sub">{h.createdBy}</td>
                <td className="admin-cell-sub">{h.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const UNIT_HINT: Record<string, string> = { inr: "₹", bps: "%", pct: "%", count: "count", bool: "1 = on, 0 = off" };

function ScheduleCard() {
  return (
    <Card title="Schedule a new value" sub="Affects future activity only. Leave the time empty to apply it now.">
      <form action={scheduleSettingAction} className="admin-grid admin-cols-2" style={{ alignItems: "end" }}>
        <div className="admin-field" style={{ marginBottom: 0 }}>
          <label htmlFor="set-key">Setting</label>
          <select id="set-key" name="key" className="admin-select" required defaultValue="">
            <option value="" disabled>
              Pick a setting
            </option>
            {KEYS.map((k) => (
              <option key={k} value={k}>
                {SETTING_META[k]?.label ?? k} ({UNIT_HINT[SETTING_META[k]?.unit ?? ""] ?? ""})
              </option>
            ))}
          </select>
        </div>
        <div className="admin-field" style={{ marginBottom: 0 }}>
          <label htmlFor="set-value">New value (in the unit shown)</label>
          <input id="set-value" name="value" className="admin-input" required inputMode="decimal" placeholder="e.g. 1999 or 5.5" />
        </div>
        <div className="admin-field" style={{ marginBottom: 0 }}>
          <label htmlFor="set-from">Effective from (IST)</label>
          <input id="set-from" name="effectiveFrom" type="datetime-local" className="admin-input" />
        </div>
        <div className="admin-field" style={{ marginBottom: 0 }}>
          <label htmlFor="set-reason">Reason</label>
          <input id="set-reason" name="reason" className="admin-input" required maxLength={500} />
        </div>
        <div>
          <button type="submit" className="admin-btn admin-btn--primary">
            Schedule value
          </button>
        </div>
      </form>
    </Card>
  );
}
