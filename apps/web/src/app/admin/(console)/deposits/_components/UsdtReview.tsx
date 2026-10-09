import type { ChainCredit, Deposit } from "@asm/db";
import { usdtNetworkDisplay } from "@/lib/usdt-network-display";
import { EmptyRow, Pill, StatusPill } from "../../../_components/ui";
import { fmtDateTime, timeAgo } from "../../../_lib/format";
import { dismissChainCreditAction, resolveChainCreditAction } from "../actions";
import { CopyText } from "./CopyText";

/* --------------------------------- Formatting -------------------------------- */

/** USDT-cents → "25.26 USDT", integer math only (no float rounding). */
export function usdtFromMinor(minor: number | null | undefined): string {
  if (minor == null) return "— USDT";
  const sign = minor < 0 ? "-" : "";
  const m = Math.abs(minor);
  return `${sign}${Math.floor(m / 100)}.${String(m % 100).padStart(2, "0")} USDT`;
}

/** "exact" or how far the reservation is from what was received, e.g. "+0.26 vs received". */
function amountDelta(reserved: number | null, received: number | null): string {
  if (reserved == null || received == null) return "amount unknown";
  const diff = reserved - received;
  if (diff === 0) return "exact";
  const m = Math.abs(diff);
  return `${diff > 0 ? "+" : "-"}${Math.floor(m / 100)}.${String(m % 100).padStart(2, "0")} vs received`;
}

/** Prisma.Decimal (NUMERIC(78,0)) or a plain bigint — only its integer string is read. */
type RawAmount = bigint | { toFixed(dp: number): string };

/**
 * Raw token amount at the credit's own decimals (6 on TRON, 18 on BSC) →
 * "25.264301 USDT", BigInt math only. Trailing zeros past the cent are
 * trimmed so an 18-dp amount stays readable; nothing is ever rounded.
 */
export function usdtFromRaw(rawAmount: RawAmount, decimals: number): string {
  const raw = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount.toFixed(0));
  const zero = BigInt(0);
  const neg = raw < zero;
  const a = neg ? -raw : raw;
  if (!Number.isInteger(decimals) || decimals < 0) return `${neg ? "-" : ""}${a.toString()} raw`;
  const scale = BigInt(10) ** BigInt(decimals);
  let frac = (a % scale).toString().padStart(decimals, "0");
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${neg ? "-" : ""}${(a / scale).toString()}${frac ? `.${frac}` : ""} USDT`;
}

/** Display label for a stored network id ("tron" → "TRON (TRC-20)"); unknown ids shown raw. */
export function usdtNetworkLabel(network: string | null | undefined): string {
  if (!network) return "—";
  return usdtNetworkDisplay(network).shortLabel;
}

/** Small pill naming the chain a payment/deposit is on. */
export function NetworkPill({ network }: { network: string | null | undefined }) {
  if (!network) return null;
  return <Pill tone="muted">{usdtNetworkLabel(network)}</Pill>;
}

/** Tx hashes compared case-insensitively and with or without a 0x prefix — a
 *  claim is stored without 0x while EVM credits keep it. */
function sameTxHash(a: string, b: string): boolean {
  const norm = (h: string) => h.trim().toLowerCase().replace(/^0x/, "");
  return norm(a) === norm(b);
}

function truncateMiddle(s: string, head = 8, tail = 6): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

const REASON_TEXT: Record<string, string> = {
  NO_LIVE_DEPOSIT: "No open deposit for this exact amount — wrong amount or sent after the window",
  AMBIGUOUS_AMOUNT: "Matched more than one open deposit",
  AMBIGUOUS_EVENT_WITHIN_TRANSACTION: "Multiple identical transfers in one transaction",
  PRECISION_NOT_REPRESENTABLE: "Amount has sub-cent precision",
  WRONG_TOKEN_CONTRACT: "Not our USDT contract",
  WRONG_NETWORK: "Wrong network",
  WRONG_DESTINATION: "Not sent to our receiving address",
  EXPIRED_DEPOSIT: "Deposit window expired",
  UNDERPAID: "Gateway deposit paid less than requested",
  ADDRESS_ALREADY_USED: "Paid again to a gateway address whose deposit is already closed",
  ADMIN_REVERSED: "Wrongly credited — reversed by an admin and returned here",
  SLOT_AMOUNT_MISMATCH: "Paid in a customer's 5-minute slot, but more than 3% off their amount and not from their wallet",
  ABOVE_MAXIMUM: "Paid in a customer's slot, above the maximum deposit",
  AMBIGUOUS_SLOT: "More than one open slot on this address (should not happen)",
};

const NEVER_CREDITABLE_REASONS = new Set(["WRONG_TOKEN_CONTRACT", "WRONG_NETWORK", "WRONG_DESTINATION"]);

/** Whether the "Credit to deposit" form may be offered for this payment. The
 *  db layer re-checks all of this (and more) — this only hides a form that
 *  would always be refused. */
export function isCreditable(c: ChainCredit): boolean {
  return (
    c.finalityState === "FINAL" &&
    c.normalizedAmountMinor !== null &&
    !(c.reviewReason && NEVER_CREDITABLE_REASONS.has(c.reviewReason))
  );
}

function notCreditableWhy(c: ChainCredit): string {
  if (c.reviewReason && NEVER_CREDITABLE_REASONS.has(c.reviewReason)) {
    return "Cannot be credited — refund off-platform, then dismiss.";
  }
  if (c.normalizedAmountMinor === null) return "Sub-cent amount — cannot be credited.";
  if (c.finalityState !== "FINAL") return `Not final yet (${c.finalityState.toLowerCase()}).`;
  return "Cannot be credited.";
}

/* ----------------------------------- Types ----------------------------------- */

export type CandidateDeposit = Deposit & {
  user: { email: string; firstName: string | null; lastName: string | null };
};

/** Structural mirror of `UsdtReviewEvidence` from @asm/db (getUsdtReviewEvidence) —
 *  kept local so this view only depends on the fields it renders. */
export type ReviewEvidence = {
  claims: {
    depositId: string;
    status: string;
    amountUsdtMinor: number | null;
    screenshotUrl: string | null;
    createdAt: Date;
    user: { id: string; email: string };
  }[];
  knownSenders: { userId: string; email: string; paidCount: number }[];
};

export type UsdtReviewRow = {
  credit: ChainCredit;
  candidates: CandidateDeposit[];
  evidence: ReviewEvidence;
};

export const EMPTY_EVIDENCE: ReviewEvidence = { claims: [], knownSenders: [] };

/** `claimedTxHash` is new on Deposit; read defensively until the Prisma client regenerates. */
function claimedTxHashOf(d: CandidateDeposit): string | null {
  return (d as { claimedTxHash?: string | null }).claimedTxHash ?? null;
}

/** Did this candidate deposit claim (paste the tx hash of) this payment? */
function claimedThisPayment(d: CandidateDeposit, c: ChainCredit, claimDepositIds: Set<string>): boolean {
  if (claimDepositIds.has(d.id)) return true;
  const h = claimedTxHashOf(d);
  return h !== null && sameTxHash(h, c.txHash);
}

/* --------------------------------- Evidence ---------------------------------- */

const EVIDENCE_LINE = { fontSize: 12, lineHeight: 1.45 } as const;
const EVIDENCE_LABEL = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 3,
} as const;

/** Who might have paid: tx-hash claims (strong hint, not proof — hashes are public)
 *  and earlier deposits paid from the same wallet (weak hint — exchanges share wallets). */
function EvidenceCell({ evidence }: { evidence: ReviewEvidence }) {
  const { claims, knownSenders } = evidence;
  const claimantCount = new Set(claims.map((cl) => cl.user.id)).size;
  const senderCount = new Set(knownSenders.map((s) => s.userId)).size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div className="admin-cell-sub" style={EVIDENCE_LABEL}>
          Claims
        </div>
        {claimantCount > 1 ? (
          <div style={{ marginBottom: 4 }}>
            <Pill tone="neg">Claimed by {claimantCount} users — investigate before crediting</Pill>
          </div>
        ) : null}
        {claims.length === 0 ? (
          <div className="admin-cell-sub" style={EVIDENCE_LINE}>
            No claim yet
          </div>
        ) : (
          claims.map((cl) => (
            <div
              key={cl.depositId}
              style={{ ...EVIDENCE_LINE, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
            >
              <span>
                Claimed by <span className="admin-cell-strong">{cl.user.email}</span>
                {" — reserved "}
                {usdtFromMinor(cl.amountUsdtMinor)}
                <span className="admin-cell-sub"> · {timeAgo(cl.createdAt)}</span>
              </span>
              <StatusPill status={cl.status} />
              {cl.screenshotUrl ? (
                <a
                  href={cl.screenshotUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open the payment screenshot"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <img
                    src={cl.screenshotUrl}
                    alt=""
                    width={22}
                    height={22}
                    style={{ objectFit: "cover", borderRadius: 3, border: "1px solid var(--admin-border)" }}
                  />
                  <span className="admin-cell-sub" style={{ fontSize: 11, textDecoration: "underline" }}>
                    screenshot
                  </span>
                </a>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div>
        <div className="admin-cell-sub" style={EVIDENCE_LABEL}>
          Sending wallet
        </div>
        {senderCount === 0 ? (
          <div className="admin-cell-sub" style={EVIDENCE_LINE}>
            New wallet
          </div>
        ) : senderCount === 1 ? (
          <div style={EVIDENCE_LINE}>
            Wallet paid before for <span className="admin-cell-strong">{knownSenders[0]!.email}</span> (
            {knownSenders.reduce((n, s) => n + s.paidCount, 0)}×)
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 4 }}>
              <Pill tone="warn">Wallet used by {senderCount} users — possibly an exchange; don&apos;t rely on it</Pill>
            </div>
            {knownSenders.map((s) => (
              <div key={s.userId} className="admin-cell-sub" style={EVIDENCE_LINE}>
                {s.email} ({s.paidCount}×)
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Banner ----------------------------------- */

export function UsdtResultBanner({ ok, error }: { ok?: string | undefined; error?: string | undefined }) {
  if (error) {
    return (
      <div
        className="admin-banner"
        role="alert"
        style={{
          background: "var(--admin-neg-soft)",
          color: "var(--admin-neg)",
          borderColor: "color-mix(in srgb, var(--admin-neg) 25%, transparent)",
        }}
      >
        <span>{error}</span>
      </div>
    );
  }
  if (ok === "resolved" || ok === "dismissed" || ok === "reversed") {
    return (
      <div
        className="admin-banner"
        role="status"
        style={{
          background: "var(--admin-pos-soft)",
          color: "var(--admin-pos)",
          borderColor: "color-mix(in srgb, var(--admin-pos) 25%, transparent)",
        }}
      >
        <span>
          {ok === "resolved"
            ? "Payment credited — the received amount was added to the user's balance."
            : ok === "reversed"
              ? "Deposit reversed — the payment is back in the queue below, ready to be credited to the right user."
              : "Payment dismissed."}
        </span>
      </div>
    );
  }
  return null;
}

/* ----------------------------------- Table ----------------------------------- */

const COLS = 8;

export function UsdtReviewTable({ rows }: { rows: UsdtReviewRow[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Received</th>
            <th className="admin-num-right">Amount</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Evidence</th>
            <th>From</th>
            <th>Tx hash</th>
            <th className="admin-num-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow cols={COLS} message="No on-chain USDT payments need review." />
          ) : (
            rows.map(({ credit: c, candidates, evidence }) => {
              const creditable = isCreditable(c);
              const claimDepositIds = new Set(evidence.claims.map((cl) => cl.depositId));
              return (
                <tr key={c.id}>
                  <td className="admin-cell-sub" style={{ whiteSpace: "nowrap" }}>
                    {fmtDateTime(c.blockTimestamp)}
                    <div style={{ marginTop: 4 }}>
                      <NetworkPill network={c.network} />
                    </div>
                  </td>
                  <td className="num admin-num-right admin-cell-strong" style={{ whiteSpace: "nowrap" }}>
                    {c.normalizedAmountMinor !== null ? (
                      usdtFromMinor(c.normalizedAmountMinor)
                    ) : (
                      <>
                        {usdtFromRaw(c.rawAmount, c.tokenDecimals)}
                        <div className="admin-cell-sub" style={{ fontSize: 11 }}>
                          sub-cent
                        </div>
                      </>
                    )}
                  </td>
                  <td style={{ minWidth: 220, maxWidth: 300 }}>
                    {c.reviewReason ? (
                      <span title={c.reviewReason}>{REASON_TEXT[c.reviewReason] ?? c.reviewReason}</span>
                    ) : (
                      <span className="admin-cell-sub">—</span>
                    )}
                  </td>
                  <td>
                    <Pill tone={c.processingStatus === "MANUAL_REVIEW" ? "warn" : "muted"}>
                      {c.processingStatus === "MANUAL_REVIEW" ? "Manual review" : c.processingStatus === "UNMATCHED" ? "Unmatched" : c.processingStatus}
                    </Pill>
                    {c.finalityState !== "FINAL" ? (
                      <div className="admin-cell-sub" style={{ fontSize: 11, marginTop: 3 }}>
                        {c.finalityState.toLowerCase()}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ minWidth: 260, maxWidth: 360 }}>
                    <EvidenceCell evidence={evidence} />
                  </td>
                  <td className="mono admin-cell-sub" style={{ fontSize: 12 }}>
                    <CopyText value={c.fromAddress} display={truncateMiddle(c.fromAddress)} label="sender address" />
                  </td>
                  <td className="mono admin-cell-sub" style={{ fontSize: 12 }}>
                    <CopyText value={c.txHash} display={truncateMiddle(c.txHash, 10, 8)} label="tx hash" />
                  </td>
                  <td className="admin-num-right">
                    <div style={{ display: "inline-flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                      {creditable ? (
                        candidates.length > 0 ? (
                          <form
                            action={resolveChainCreditAction}
                            style={{ display: "flex", gap: 6, alignItems: "center" }}
                          >
                            <input type="hidden" name="chainCreditId" value={c.id} />
                            {/* Never pre-select: candidates are ranked by claim then amount,
                                across all users, and a claim is not proof (tx hashes are
                                public), so a default would silently credit on a hint. The
                                operator must pick the user explicitly. */}
                            <select
                              name="depositId"
                              required
                              defaultValue=""
                              className="admin-select"
                              aria-label="Deposit to credit"
                              style={{ width: "auto", maxWidth: 420, padding: "5px 8px", fontSize: 12 }}
                            >
                              <option value="" disabled>
                                Choose the user&apos;s deposit…
                              </option>
                              {candidates.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {`${claimedThisPayment(d, c, claimDepositIds) ? "★ Claimed — " : ""}${d.user.email} — reserved ${usdtFromMinor(d.amountUsdtMinor)} (${amountDelta(d.amountUsdtMinor, c.normalizedAmountMinor)}) — ${d.status === "EXPIRED" ? "expired" : "unpaid"} — ${timeAgo(d.createdAt)}`}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="admin-btn admin-btn--sm admin-btn--pos"
                              title="Credits the amount actually received on-chain, not the deposit's reserved amount."
                              style={{ whiteSpace: "nowrap" }}
                            >
                              Credit {usdtFromMinor(c.normalizedAmountMinor)}
                            </button>
                          </form>
                        ) : (
                          <span className="admin-cell-sub" style={{ fontSize: 12 }}>
                            No candidate deposits
                          </span>
                        )
                      ) : (
                        <span className="admin-cell-sub" style={{ fontSize: 12 }}>
                          {notCreditableWhy(c)}
                        </span>
                      )}
                      <form
                        action={dismissChainCreditAction}
                        style={{ display: "flex", gap: 6, alignItems: "center" }}
                      >
                        <input type="hidden" name="chainCreditId" value={c.id} />
                        <input
                          name="note"
                          required
                          maxLength={500}
                          placeholder="Reason, e.g. refunded to sender"
                          aria-label="Dismissal reason"
                          className="admin-input"
                          style={{ minWidth: 200, padding: "5px 8px", fontSize: 12 }}
                        />
                        <button type="submit" className="admin-btn admin-btn--sm admin-btn--danger">
                          Dismiss
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
