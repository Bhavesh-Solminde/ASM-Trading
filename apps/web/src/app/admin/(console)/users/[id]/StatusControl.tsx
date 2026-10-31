import type { UserStatus } from "@asm/db";
import { setUserStatusAction } from "../actions";
import {
  USER_STATUS_LABEL,
  USER_STATUS_REASONS,
} from "../../../_lib/user-status";

const COPY: Record<UserStatus, { heading: string; body: string; cta: string; tone: "warn" | "danger" | "pos" }> = {
  FLAGGED: {
    heading: "Flag this account",
    body: "Watchlist marker. No restrictions are applied — the account can keep trading, depositing and withdrawing. The flag shows up on the users list and in the fraud queue.",
    cta: "Flag account",
    tone: "warn",
  },
  FROZEN: {
    heading: "Freeze this account",
    body: "Blocks new trades, deposits and withdrawals. Closes every open CFD position at the current mark. Signs the user out of every device. Reversible: Reactivate restores the account.",
    cta: "Freeze account",
    tone: "warn",
  },
  BANNED: {
    heading: "Ban this account",
    body: "Same restrictions as Freeze: blocked, positions closed, signed out everywhere. Treat as irreversible from this panel — balance is preserved but only a DB edit can rehabilitate. Type BAN below to confirm.",
    cta: "Ban account",
    tone: "danger",
  },
  ACTIVE: {
    heading: "Reactivate this account",
    body: "Returns the user to ACTIVE. Does not reopen positions that were closed on freeze or ban.",
    cta: "Reactivate account",
    tone: "pos",
  },
};

function ActionForm({
  userId,
  status,
}: {
  userId: string;
  status: UserStatus;
}) {
  const copy = COPY[status];
  const btnTone =
    copy.tone === "danger" ? "admin-btn--danger" : copy.tone === "pos" ? "admin-btn--pos" : "admin-btn--subtle";
  const summaryTone =
    copy.tone === "danger" ? "admin-btn--danger" : copy.tone === "pos" ? "admin-btn--pos" : "admin-btn";
  return (
    <details className="admin-status__action">
      <summary className={`admin-btn admin-btn--sm ${summaryTone}`}>{USER_STATUS_LABEL[status]}</summary>
      <form action={setUserStatusAction} className="admin-status__form">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="status" value={status} />
        <div className="admin-status__copy">
          <strong>{copy.heading}</strong>
          <p>{copy.body}</p>
        </div>
        <div className="admin-set-row">
          <div>
            <label className="lbl" htmlFor={`reasonCode-${status}`}>
              Reason
            </label>
            <div className="desc">Pick the closest match; add a note below if needed</div>
          </div>
          <select
            id={`reasonCode-${status}`}
            name="reasonCode"
            className="admin-filter-select"
            defaultValue={status === "ACTIVE" ? "reactivated" : "manual_review"}
            required
          >
            {USER_STATUS_REASONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-set-row">
          <div>
            <label className="lbl" htmlFor={`reasonNote-${status}`}>
              Note (optional)
            </label>
            <div className="desc">Up to 500 characters</div>
          </div>
          <input
            id={`reasonNote-${status}`}
            name="reasonNote"
            className="admin-filter-select"
            maxLength={500}
            placeholder="Context, ticket id, link…"
          />
        </div>
        {status === "BANNED" ? (
          <div className="admin-set-row">
            <div>
              <label className="lbl" htmlFor="confirmPhrase">
                Type <code>BAN</code> to confirm
              </label>
              <div className="desc">Required to prevent accidental bans</div>
            </div>
            <input
              id="confirmPhrase"
              name="confirmPhrase"
              className="admin-filter-select"
              pattern="BAN"
              required
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ) : null}
        <div className="admin-status__footer">
          <button type="submit" className={`admin-btn admin-btn--sm ${btnTone}`}>
            {copy.cta}
          </button>
        </div>
      </form>
    </details>
  );
}

export function StatusControl({
  userId,
  current,
}: {
  userId: string;
  current: UserStatus;
}) {
  // Current status's own button is suppressed; Reactivate only appears when
  // the user is not already ACTIVE.
  const buttons: UserStatus[] = (["FLAGGED", "FROZEN", "BANNED", "ACTIVE"] as UserStatus[]).filter(
    (s) => s !== current && (s !== "ACTIVE" || current !== "ACTIVE"),
  );
  return (
    <div className="admin-status__actions">
      {buttons.map((s) => (
        <ActionForm key={s} userId={userId} status={s} />
      ))}
    </div>
  );
}
