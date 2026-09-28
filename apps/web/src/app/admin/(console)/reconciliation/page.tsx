import {
  countOpenReconciliationIssues,
  listOpenReconciliationIssues,
  listRecentlyResolvedReconciliationIssues,
  type ReconciliationIssue,
} from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { Card, EmptyRow, Pill, StatCard } from "../../_components/ui";
import { fmtDateTime, timeAgo } from "../../_lib/format";
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
};

function checkLabel(checkName: string): string {
  return CHECK_LABELS[checkName] ?? checkName.replace(/_/g, " ");
}

function truncateMiddle(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function SeverityPill({ severity }: { severity: string }) {
  return <Pill tone={severity === "P1" ? "neg" : "warn"}>{severity}</Pill>;
}

function SubjectCell({ subjectType, subjectId }: { subjectType: string; subjectId: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="admin-cell-sub" style={{ fontSize: 11 }}>{subjectType}</span>
      <span className="mono">
        <CopyText value={subjectId} display={truncateMiddle(subjectId)} label={`${subjectType} id`} />
      </span>
    </div>
  );
}

function IssueRows({ issues, resolved }: { issues: ReconciliationIssue[]; resolved?: boolean }) {
  return (
    <>
      {issues.map((i) => (
        <tr key={i.id}>
          <td><SeverityPill severity={i.severity} /></td>
          <td>{checkLabel(i.checkName)}</td>
          <td>{usdtNetworkLabel(i.network)}</td>
          <td><SubjectCell subjectType={i.subjectType} subjectId={i.subjectId} /></td>
          <td className="admin-cell-sub" style={{ maxWidth: 360 }} title={i.message}>
            {i.message}
          </td>
          <td className="admin-cell-sub">{fmtDateTime(i.firstDetectedAt)}</td>
          {resolved ? (
            <td className="admin-cell-sub">{i.resolvedAt ? timeAgo(i.resolvedAt) : "—"}</td>
          ) : (
            <td className="admin-cell-sub">{timeAgo(i.lastSeenAt)}</td>
          )}
        </tr>
      ))}
    </>
  );
}

export default async function ReconciliationPage() {
  await requireAdmin();

  const [{ p1, warning }, openIssues, resolvedIssues] = await Promise.all([
    countOpenReconciliationIssues(),
    listOpenReconciliationIssues(100),
    listRecentlyResolvedReconciliationIssues(20),
  ]);

  return (
    <>
      <div className="admin-grid admin-stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <StatCard
          label="Open P1 issues"
          value={String(p1)}
          icon="ban"
          warn={p1 > 0}
          foot={<span>invariant breaks — these should be structurally impossible</span>}
        />
        <StatCard
          label="Open warnings"
          value={String(warning)}
          icon="clock"
          warn={warning > 0}
          foot={<span>operational visibility, not necessarily a bug</span>}
        />
        <StatCard
          label="On-demand check"
          value=""
          icon="check"
          foot={
            <form action={runReconciliationNowAction}>
              <button type="submit" className="admin-btn admin-btn--sm">
                Run now
              </button>
            </form>
          }
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="Open issues"
          sub="USDT deposit / on-chain credit invariant checks (TRON + BSC). Runs automatically every few minutes; Run now forces an immediate pass."
          noBody
        >
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Check</th>
                  <th>Network</th>
                  <th>Subject</th>
                  <th>Message</th>
                  <th>First detected</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {openIssues.length === 0 ? (
                  <EmptyRow cols={7} message="No open issues. The books check out." />
                ) : (
                  <IssueRows issues={openIssues} />
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Recently resolved" sub="Last 20, most recently resolved first." noBody>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Check</th>
                  <th>Network</th>
                  <th>Subject</th>
                  <th>Message</th>
                  <th>First detected</th>
                  <th>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {resolvedIssues.length === 0 ? (
                  <EmptyRow cols={7} message="No issues have been resolved yet." />
                ) : (
                  <IssueRows issues={resolvedIssues} resolved />
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
