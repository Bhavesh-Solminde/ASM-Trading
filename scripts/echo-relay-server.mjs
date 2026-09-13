#!/usr/bin/env node
/* eslint-disable no-undef -- Node.js script executed directly with `node`; process/console are ambient Node globals, not undeclared. */
/**
 * Throwaway relay echo server — NOT part of the monorepo, NOT the real
 * /api/bank-feed/sms endpoint. It exists only to prove the companion app's
 * relay path (auth header, payload shape, network reachability) works before
 * Plan 05's real Next.js route exists. Same contract, so the app needs zero
 * changes when it later points at the real server.
 *
 * Usage: SMS_RELAY_SECRET=some-secret node scripts/echo-relay-server.mjs
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3000);
const SECRET = process.env.SMS_RELAY_SECRET ?? "local-dev-relay-secret-change-me";

// Same candidate-plus-disambiguate approach as the real parser (Plan 05),
// simplified here just to prove the message is usable.
const AMOUNT_RE = /(?:rs\.?|inr)\s?([0-9][0-9,]{0,18}(?:\.[0-9]{1,2})?)/i;
const REF_RE = /\b([0-9]{9,22})\b/;
const CREDIT_RE = /\b(credited|credit|received|deposited)\b/i;
const DEBIT_RE = /\b(debited|debit|spent|withdrawn|paid|purchase)\b/i;

function parse(body) {
  const amountMatch = AMOUNT_RE.exec(body);
  if (!amountMatch) return null;
  const amountInr = Math.round(Number(amountMatch[1].replace(/,/g, "")) * 100);
  const refMatch = REF_RE.exec(body);
  const isCredit = CREDIT_RE.test(body) && !DEBIT_RE.test(body);
  return { amountInr, utr: refMatch ? refMatch[1] : null, isCredit };
}

let count = 0;

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/bank-feed/sms") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${SECRET}`) {
    console.log(`[${new Date().toISOString()}] 401 unauthorised (got: ${auth ?? "none"})`);
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorised." }));
    return;
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk.toString();
    if (raw.length > 10_000) req.destroy();
  });

  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "malformed json" }));
      return;
    }

    count += 1;
    const parsed = parse(payload.body ?? "");

    console.log(`\n[${new Date().toISOString()}] message #${count} received`);
    console.log(`  sender:      ${payload.sender}`);
    console.log(`  body:        ${payload.body}`);
    console.log(`  receivedAt:  ${payload.receivedAt}`);
    if (parsed) {
      console.log(`  PARSED       amount=₹${(parsed.amountInr / 100).toFixed(2)}  utr=${parsed.utr ?? "none"}  credit=${parsed.isCredit}`);
    } else {
      console.log(`  PARSED       no amount found — would be ignored (202)`);
    }

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, parsed }));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Echo relay server listening on http://0.0.0.0:${PORT}`);
  console.log(`Expecting Authorization: Bearer ${SECRET}`);
  console.log(`Waiting for POST /api/bank-feed/sms ...\n`);
});
