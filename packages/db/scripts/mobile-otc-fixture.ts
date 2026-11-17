import { hash } from "argon2";
import { prisma } from "../src/client";
const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "55449" || url.pathname !== "/mobile_otc_demo") throw new Error("Disposable local database only");
const email = "mobile-otc@example.test";
const user = await prisma.user.upsert({ where: { email_role_legacySimulated: { email, role: "USER", legacySimulated: false } }, create: { email, passwordHash: await hash("local-mobile-otc-only"), liveAccess: true, vpnExempt: true }, update: {} });
for (const type of ["DEMO", "LIVE"] as const) {
  await prisma.account.upsert({ where: { userId_type: { userId: user.id, type } }, create: { userId: user.id, type, currency: "INR", realBalance: 100_000_000 }, update: {} });
}
console.log("Prepared disposable local login; all balances are dummy funds.");
await prisma.$disconnect();
