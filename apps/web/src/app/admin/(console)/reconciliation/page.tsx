import {
  countOpenReconciliationIssues,
  listOpenReconciliationIssues,
  listRecentlyResolvedReconciliationIssues,
  type ReconciliationIssue,
} from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { EmptyRow, PageHead, Pill, TabBar } from "../../_components/ui";
import { Icon } from "../../_lib/icons";
import { fmtDateTime, hrefWith, timeAgo } from "../../_lib/format";
import { CopyText } from "../deposits/_components/CopyText";
import { usdtNetworkLabel } from "../deposits/_components/UsdtReview";
import { runReconciliationNowAction } from "./actions";

export const dynamic = "force-dynamic";

/** Short, factual labels for the 8 fixed checkNames — see packages/db's
 *  reconciliation.ts for what each actually verifies. Anything unrecognised
 *  (there shouldn't be any) falls back to the raw check name. */
const CHECK_LABELS: Record<string, string> = {
  completed_deposit_broken_credit_link: "Completed deposit's credit link is broken",
  matched_credit_broken_deposit_link: "Matched credit's deposit link is broken",
  completed_usdt_amount_mismatch: "Deposit amount doesn't match its credit",
  completed_usdt_network_mismatch: "Deposit network/contract/address doesn't match its credit",
  completed_usdt_transaction_count: "Wrong ledger transaction count for deposit",
  duplicate_chain_credit_identity: "Duplicate on-chain credit identity",
  duplicate_matched_chain_credit: "Multiple deposits matched to one credit",
  stuck_unconfirmed_transfer: "Transfer stuck unconfirmed too long",
  // names the demo seed uses
  credited_without_chain_credit: "Credited without an on-chain transfer",
  stuck_detected_transfer: "Transfer stuck before finality",
  duplicate_tx_credit: "Two deposits credited from one transaction",
};

function checkLabel(checkName: string): string {
  return CHECK_LABELS[checkName] ?? checkName.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function truncateMiddle(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function SeverityPill({ severity }: { severity: string }) {
  return <Pill tone={severity === "P1" ? "neg" : "warn"}>{severity === "P1" ? "P1" : "Warning"}</Pill>;
}

function SubjectCell({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="admin-cell-sub">{subjectType.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
      <CopyText value={subjectId} display={truncateMiddle(subjectId)} label={`${subjectType} id`} />
    </div>
  );
}

function IssueRows({ issues, resolved }: { issues: ReconciliationIssue[]; resolved?: boolean }) {
  return (
    <>
      {issues.map((i) => (
        <tr key={i.id}>
          <td><SeverityPill severity={i.severity} /></td>
          <td style={{ maxWidth: 420 }}>
            <div className="admin-cell-strong">{checkLabel(i.checkName)}</div>
            <div className="admin-cell-sub" style={{ marginTop: 2, lineHeight: 1.4 }}>
              {i.message}
            </div>
          </td>
          <td>{usdtNetworkLabel(i.network)}</td>
          <td><SubjectCell subjectType={i.subjectType} subjectId={i.subjectId} /></td>
          <td className="admin-age">{fmtDateTime(i.firstDetectedAt)}</td>
          {resolved ? (
            <td className="admin-age">{i.resolvedAt ? timeAgo(i.resolvedAt) : "—"}</td>
          ) : (
            <td className="admin-age">{timeAgo(i.lastSeenAt)}</td>
          )}
        </tr>
      ))}
    </>
  );
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = sp.tab === "resolved" ? "resolved" : "open";

  const [{ p1, warning }, openIssues, resolvedIssues] = await Promise.all([
    countOpenReconciliationIssues(),
    listOpenReconciliationIssues(100),
    listRecentlyResolvedReconciliationIssues(20),
  ]);
  // P1s first, then warnings; oldest first within each.
  const sorted = [...openIssues].sort(
    (a, b) =>
      (a.severity === "P1" ? 0 : 1) - (b.severity === "P1" ? 0 : 1) ||
      a.firstDetectedAt.getTime() - b.firstDetectedAt.getTime(),
  );
  const lastChecked = openIssues.reduce<Date | null>(
    (m, i) => (!m || i.lastSeenAt > m ? i.lastSeenAt : m),
    null,
  );
  const rows = tab === "open" ? sorted : resolvedIssues;
  const tabHref = (key: string) => hrefWith("/admin/reconciliation", {}, { tab: key === "open" ? null : key });

  return (
    <>
      <PageHead
        title="Reconciliation"
        desc={
          <>
            USDT deposits checked against on-chain credits (TRON and BSC). Runs on its own every few minutes
            {lastChecked ? <> · last flagged something {timeAgo(lastChecked)}</> : null}.
          </>
        }
        actions={
          <form action={runReconciliationNowAction}>
            <button type="submit" className="admin-btn admin-btn--ghost">
              <Icon name="activity" size={16} />
              Run check now
            </button>
          </form>
        }
      />

      <section className="admin-card">
        <TabBar
          label="Issue views"
          active={tab}
          tabs={[
            { key: "open", label: "Open", href: tabHref("open"), count: p1 + warning },
            { key: "resolved", label: "Resolved", href: tabHref("resolved"), count: resolvedIssues.length },
          ]}
        />
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Issue</th>
                <th>Network</th>
                <th>Subject</th>
                <th>First detected</th>
                <th>{tab === "open" ? "Last seen" : "Resolved"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow
                  cols={6}
                  message={tab === "open" ? "No open issues. The books check out." : "No issues have been resolved yet."}
                />
              ) : (
                <IssueRows issues={rows} resolved={tab === "resolved"} />
              )}
            </tbody>
          </table>
        </div>
        <div className="admin-pager">
          <span className="info">
            P1 should be impossible: investigate now. A warning is worth a look but isn&rsquo;t necessarily a bug.
          </span>
        </div>
      </section>
    </>
  );
}
