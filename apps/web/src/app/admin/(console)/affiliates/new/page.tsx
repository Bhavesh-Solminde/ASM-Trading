import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAffiliateAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewAffiliatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const error = sp.error;

  return (
    <div className="admin-card" style={{ maxWidth: 560 }}>
      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Create affiliate</h2>
          <p
            className="admin-cell-sub"
            style={{ margin: "6px 0 0", fontSize: 12 }}
          >
            Both accounts start at ₹10,000 and reset every day at 00:00 IST.
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="admin-cell-sub"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.08)",
              color: "#ef4444",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <form
          action={createAffiliateAction}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="off"
              className="admin-input"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--admin-border)",
                background: "var(--admin-bg-input)",
                color: "inherit",
                fontSize: 14,
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Password{" "}
              <span className="admin-cell-sub" style={{ fontWeight: 400 }}>
                (min 12 chars)
              </span>
            </span>
            <input
              type="text"
              name="password"
              required
              minLength={12}
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="admin-input"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--admin-border)",
                background: "var(--admin-bg-input)",
                color: "inherit",
                fontSize: 14,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
              }}
            />
            <span className="admin-cell-sub" style={{ fontSize: 11 }}>
              Shown in plain text so you can share it with the streamer.
              If a password you set here doesn&apos;t work at login, use the{" "}
              <strong>Set password</strong> button on the list to try again —
              some browsers autofill this field.
            </span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Nickname{" "}
              <span className="admin-cell-sub" style={{ fontWeight: 400 }}>
                (optional)
              </span>
            </span>
            <input
              type="text"
              name="nickname"
              autoComplete="off"
              className="admin-input"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--admin-border)",
                background: "var(--admin-bg-input)",
                color: "inherit",
                fontSize: 14,
              }}
            />
          </label>

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <Link
              href="/admin/affiliates"
              className="admin-btn admin-btn--sm admin-btn--subtle"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="admin-btn admin-btn--sm admin-btn--pos"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
