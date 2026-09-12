import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

interface MessageRow {
  id: number;
  device_label: string | null;
  device_model: string | null;
  sender: string;
  body: string;
  received_at: string;
  amount_inr: number | null;
  utr: string | null;
  is_credit: boolean | null;
}

async function loadMessages(): Promise<{ rows: MessageRow[]; error: string | null }> {
  try {
    const sql = getSql();
    const rows = await sql<MessageRow[]>`
      select id, device_label, device_model, sender, body, received_at,
             amount_inr, utr, is_credit
        from messages
       order by created_at desc
       limit 200
    `;
    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function formatAmount(amountInr: number | null, isCredit: boolean | null): string {
  if (amountInr == null) return "—";
  const sign = isCredit === false ? "-" : isCredit === true ? "+" : "";
  return `${sign}₹${(amountInr / 100).toFixed(2)}`;
}

export default async function MessagesPage() {
  const { rows, error } = await loadMessages();

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Received messages</h1>
      <p style={{ color: "#6b7a8d", fontSize: 13, marginTop: 0, marginBottom: 24 }}>
        Last 200 messages forwarded by any relay app instance, newest first.
      </p>

      {error ? (
        <p style={{ color: "#e0526a" }}>Could not load messages: {error}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#93a2b4" }}>No messages received yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#93a2b4", borderBottom: "1px solid #253243" }}>
                <th style={{ padding: "8px 12px" }}>Device</th>
                <th style={{ padding: "8px 12px" }}>Sender</th>
                <th style={{ padding: "8px 12px" }}>Message</th>
                <th style={{ padding: "8px 12px" }}>Amount</th>
                <th style={{ padding: "8px 12px" }}>UTR</th>
                <th style={{ padding: "8px 12px" }}>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: "1px solid #16202c" }}>
                  <td style={{ padding: "8px 12px" }}>
                    {row.device_label ?? "—"}
                    {row.device_model ? (
                      <div style={{ color: "#6b7a8d", fontSize: 11 }}>{row.device_model}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 12px" }}>{row.sender}</td>
                  <td style={{ padding: "8px 12px", maxWidth: 360 }}>{row.body}</td>
                  <td
                    style={{
                      padding: "8px 12px",
                      color:
                        row.is_credit === true
                          ? "#2fbd85"
                          : row.is_credit === false
                            ? "#e0526a"
                            : "#93a2b4",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatAmount(row.amount_inr, row.is_credit)}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#6b7a8d" }}>{row.utr ?? "—"}</td>
                  <td style={{ padding: "8px 12px", color: "#6b7a8d", whiteSpace: "nowrap" }}>
                    {new Date(row.received_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
