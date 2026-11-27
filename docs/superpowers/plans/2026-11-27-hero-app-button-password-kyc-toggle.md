# Hero App Button, Minimal Password, KYC Switch — Implementation Plan

> **For agentic workers:** Execute task-by-task in order. Steps use checkbox (`- [ ]`) syntax. Use TDD where a step gives a test. **Do not commit or push** (see Global Constraints).

**Goal:** (1) a "Download app" button beside "Start free demo" in the homepage hero that downloads the Android APK; (2) replace the password-strength feature with a plain 6-character minimum; (3) an admin switch that turns KYC off for every client, after which no client sees KYC anywhere and withdrawals no longer need it.

**Architecture:** The KYC switch is one boolean in a new singleton table `PlatformSettings` (id = 1, missing row = KYC required), read through `isKycRequired()` in `@asm/db` and written by `setKycRequired()` with an audit row. Every server gate (real-money withdrawal, affiliate-program withdrawal) and every client surface (web pages, app API → Android app) reads it. The app API adds `kycRequired` to the bootstrap and withdrawal-prefill payloads with `.default(true)`, so old servers and old apps keep today's behaviour.

**Tech Stack:** pnpm monorepo, Next.js App Router (apps/web), Prisma 7 + Postgres (packages/db), zod contracts (packages/contracts), Expo / React Native (apps/mobile), vitest.

## Global Constraints

- **Do NOT `git commit`, `git push`, or open a PR.** Leave every change uncommitted in this worktree (branch `feat/hero-app-button-password-kyc-toggle`). The owner approves screenshots before anything is committed.
- **Database: only the isolated local DB `asm_kyc_toggle`.** The repo `.env` points at a shared Supabase dev DB used by other people; this worktree has no `.env`, keep it that way. Before any prisma / vitest / tsx command in this session, export:
  ```bash
  export U=postgresql://solminde@localhost:5433/asm_kyc_toggle
  export DATABASE_URL=$U DIRECT_URL=$U DATABASE_MIGRATE_URL=$U
  export REDIS_URL=redis://localhost:6379/9
  export SESSION_SECRET=local-test-secret-at-least-32-characters-long
  ```
  `asm_kyc_toggle` is already migrated (all existing migrations) and seeded. Every `prisma migrate deploy` must print `Datasource "db": PostgreSQL database "asm_kyc_toggle" ... at "localhost:5433"`. If it names anything else, stop.
- **Never run `prisma format` or `prisma migrate dev`.** `schema.prisma` has pre-existing drift; migrations are hand-written SQL, applied with `prisma migrate deploy`.
- After editing `schema.prisma`, run `pnpm db:generate` (from repo root) so the client and `tsc` see the new model.
- Match surrounding code: comment density, naming, Tailwind token classes (`text-ink`, `bg-panel`, `border-rule`, `bg-brand-fill`), and admin classes (`admin-btn`, `Pill`, `Row`). No new dependencies.
- Copy rules: user-facing text is plain English; no em dashes in new copy.
- Password: minimum **6** characters for sign-up and reset (web + Android); login accepts any non-empty password up to 200 chars. Existing passwords keep working.
- KYC switch: **one global switch**, in Admin → Settings, default **on** (required). When **off**: clients see no KYC badges, rows, cards, hints or verify pages on web or Android; real-money and affiliate-program withdrawals do not check KYC. Admin KYC pages keep working; nothing already submitted is deleted; turning it back on restores today's behaviour exactly.
- Hero button: links straight to `/download/app` (the existing route that redirects to the current APK). Plain `<a>`, not `next/link` (it is a route handler that returns a file).

---

### Task 1: Hero "Download app" button

**Files:**
- Modify: `apps/web/src/components/marketing/LandingShowcase.tsx:24-29` (inside `CinematicHero`)

- [ ] **Step 1: Replace the single CTA link with a two-button row.**

Replace the existing `<Link href="/register" className="mt-6 inline-flex ...">Start free demo ...</Link>` block with:

```tsx
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:mt-8">
          <Link
            href="/register"
            className="inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-brand-fill px-7 text-sm font-bold text-brand-ink hover:bg-brand-fill-hi sm:min-h-14 sm:text-base"
          >
            Start free demo <span aria-hidden="true">↗</span>
          </Link>
          <a
            href="/download/app"
            className={`${styles.photoChip} inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full border px-6 text-sm font-bold sm:min-h-14 sm:text-base`}
          >
            <svg aria-hidden="true" className="size-5 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
            </svg>
            Download app
          </a>
        </div>
```

`styles.photoChip` (already in `LandingShowcase.module.css`) gives the frosted panel background, border, and brand-coloured hover border in both light and dark themes. The download icon path is the same one `AppDownloads` in `BoldLanding.tsx` uses.

- [ ] **Step 2: Check the layout rules by reading the markup.** At phone width (390px) the two buttons must sit side by side if they fit, else wrap centred with a 12px gap; no horizontal scroll. Nothing else in the hero moves.

---

### Task 2: Minimal password (6 characters, no strength meter)

**Files:**
- Modify: `packages/contracts/src/auth.ts:9-12,31-38`
- Modify: `packages/contracts/src/auth.test.ts:21-25,67-71`
- Modify: `apps/web/src/components/auth/PasswordInput.tsx` (remove strength feature)
- Modify: `apps/web/src/app/(auth)/register/RegisterForm.tsx:13,148`
- Modify: `apps/web/src/app/(auth)/reset-password/ResetPasswordForm.tsx:29,86-96`
- Modify: `apps/web/src/app/api/auth/password-reset/flow.test.ts:82-85`
- Modify: `apps/mobile/src/i18n/en.json:32,42`, `apps/mobile/src/i18n/hi.json:32,42`
- Modify: `apps/mobile/src/auth/messages.test.ts:32-36`

- [ ] **Step 1: Update the contract tests first.** In `packages/contracts/src/auth.test.ts` replace the `"rejects a password under 12 characters"` test with:

```ts
  it("rejects a password under 6 characters and accepts 6", () => {
    expect(RegisterSchema.safeParse({ ...valid, password: "abcde" }).success).toBe(false);
    expect(RegisterSchema.safeParse({ ...valid, password: "abcdef" }).success).toBe(true);
  });

  it("lets an existing user sign in with any non-empty password", () => {
    expect(LoginSchema.safeParse({ email: "a@b.com", password: "abc" }).success).toBe(true);
    expect(LoginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
```

and in `"applies the signup password rule on confirm"` change `"short"` to `"abcde"` and add `expect(PasswordResetConfirmSchema.safeParse({ token, password: "abcdef" }).success).toBe(true);`.

- [ ] **Step 2: Run them and watch them fail.**
Run: `pnpm --filter @asm/contracts test`
Expected: FAIL on the 6-character and login cases.

- [ ] **Step 3: Split the password rule in `packages/contracts/src/auth.ts`.** Replace the `password` const with:

```ts
/** New passwords (sign-up, reset). Kept short on purpose: the owner asked for a minimal rule. */
const newPassword = z
  .string()
  .min(6, "Use at least 6 characters")
  .max(200, "Password is too long");

/** Sign-in accepts whatever the account was created with, including older 12+ character passwords. */
const password = z.string().min(1, "Enter your password").max(200, "Password is too long");
```

Then: `RegisterSchema` uses `password: newPassword`, `LoginSchema` keeps `password`, `PasswordResetConfirmSchema` uses `password: newPassword`:

```ts
export const RegisterSchema = z.strictObject({ name, email, password: newPassword, portal, referralCode });
export const LoginSchema = z.strictObject({ email, password, portal });
...
export const PasswordResetConfirmSchema = z.strictObject({
  token: z.string().min(32).max(128),
  password: newPassword,
});
```

- [ ] **Step 4: Run contracts tests.** `pnpm --filter @asm/contracts test` → PASS.

- [ ] **Step 5: Remove the strength feature from `apps/web/src/components/auth/PasswordInput.tsx`.** Delete the `showStrength` prop (type, destructuring, the `const strength = ...` line, and the `{strength && value.length > 0 ? <StrengthMeter .../> : null}` render line), and delete `STRENGTH_LABELS`, `STRENGTH_COLORS`, `StrengthMeter`, and `scorePassword`. Keep the eye toggle, Caps Lock notice, and "Forgot password?" link unchanged.

- [ ] **Step 6: Register form.** In `RegisterForm.tsx`: `const MIN_PASSWORD_LEN = 6;` and delete the `showStrength` prop from the first `<PasswordInput>`. The placeholder already reads `` `At least ${MIN_PASSWORD_LEN} characters` ``.

- [ ] **Step 7: Reset form.** In `ResetPasswordForm.tsx`: line 29 becomes `if (password.length < 6) return setError("Use at least 6 characters.");`; both `minLength={12}` become `minLength={6}`; placeholder becomes `"At least 6 characters"`; delete `showStrength`.

- [ ] **Step 8: Reset flow test.** In `apps/web/src/app/api/auth/password-reset/flow.test.ts` rename the test to `"refuses a password under 6 characters with the rule's own message"`, make the posted password 5 characters (e.g. `"abcde"`), and expect `/6 characters/`.

- [ ] **Step 9: Android strings.** `en.json`: `"passwordHint": "At least 6 characters"`, `"errPassword": "Password must be at least 6 characters."`. `hi.json`: `"passwordHint": "कम से कम 6 अक्षर"`, `"errPassword": "पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।"`.

- [ ] **Step 10: Android message test.** In `apps/mobile/src/auth/messages.test.ts` the password case uses `LoginSchema` with `"short"`, which is now valid for login. Change it to:

```ts
    const p = RegisterSchema.safeParse({ name: "Asha Rao", email: "a@b.co", password: "abcde" });
    expect(p.success ? null : validationKey(p.error.issues)).toBe("auth.errPassword");
```

- [ ] **Step 11: Sweep for leftovers.** Run `grep -rn "12 char\|min(12\|minLength={12}\|showStrength\|scorePassword" --include='*.ts' --include='*.tsx' --include='*.json' apps packages | grep -v node_modules | grep -v generated`. Expected: only the unrelated comment in `apps/web/src/lib/parse-bank-sms.ts`.

- [ ] **Step 12: Run the touched suites.** With the env from Global Constraints exported:
`pnpm --filter @asm/contracts test && (cd apps/mobile && npx vitest run src/auth) && (cd apps/web && npx vitest run src/app/api/auth)` → PASS.

---

### Task 3: KYC switch storage and server gates

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add model after `OtcVaultSettings`, ~line 592)
- Create: `packages/db/prisma/migrations/20261127120000_platform_settings/migration.sql`
- Create: `packages/db/src/repositories/platform-settings.ts`
- Create: `packages/db/src/repositories/platform-settings.test.ts`
- Modify: `packages/db/src/index.ts` (export)
- Modify: `packages/db/src/repositories/withdrawal.ts:148-151,188-196`
- Modify: `packages/db/src/repositories/withdrawal.test.ts:134-` (add a case)
- Modify: `packages/db/src/repositories/program-wallet.ts:233-239,~320-350`
- Modify: `packages/db/src/repositories/program-withdrawal.ts:65`

**Interfaces:**
- Produces: `isKycRequired(client?: Pick<DbTransaction, "platformSettings">): Promise<boolean>` and `setKycRequired(kycRequired: boolean, actorId: string): Promise<boolean>` (returns whether the value changed), both exported from `@asm/db`. Audit action string: `"platform.kyc_requirement_changed"`.
- Produces: `programActionBlockers(u, action, hasLiveAccount, kycRequired = true)`.

- [ ] **Step 1: Schema.** Add to `schema.prisma` directly after `model OtcVaultSettings { ... }` (hand-edit; do not run `prisma format`):

```prisma
/// Platform-wide switches the admin console changes at runtime. Singleton
/// (id = 1); a missing row means every default below. History is in AuditLog.
model PlatformSettings {
  id          Int     @id @default(1)
  /// Clients must pass KYC before withdrawing. Off = KYC hidden and not checked.
  kycRequired Boolean @default(true)
}
```

- [ ] **Step 2: Migration.** Create `packages/db/prisma/migrations/20261127120000_platform_settings/migration.sql`:

```sql
CREATE TABLE "PlatformSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "kycRequired" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformSettings_singleton" CHECK ("id" = 1)
);
```

No row is inserted: absent row = required, so deploying changes nothing until an admin flips the switch.

- [ ] **Step 3: Apply and generate.**
Run (env exported): `(cd packages/db && npx prisma migrate deploy) && pnpm db:generate`
Expected: `Datasource "db": PostgreSQL database "asm_kyc_toggle"` and `1 migration ... applied`.

- [ ] **Step 4: Write the failing repository test** `packages/db/src/repositories/platform-settings.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { isKycRequired, setKycRequired } from "./platform-settings";

const ACTOR = "test-platform-settings";

beforeEach(async () => {
  await prisma.platformSettings.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { actorId: ACTOR } });
});

afterAll(async () => {
  await prisma.platformSettings.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { actorId: ACTOR } });
  await prisma.$disconnect();
});

describe("KYC requirement switch", () => {
  it("defaults to required when no row exists", async () => {
    expect(await isKycRequired()).toBe(true);
  });

  it("turns off and back on, auditing each real change once", async () => {
    expect(await setKycRequired(false, ACTOR)).toBe(true);
    expect(await isKycRequired()).toBe(false);
    expect(await setKycRequired(false, ACTOR)).toBe(false);
    expect(await setKycRequired(true, ACTOR)).toBe(true);
    expect(await isKycRequired()).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { actorId: ACTOR }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => [a.action, a.before, a.after])).toEqual([
      ["platform.kyc_requirement_changed", { kycRequired: true }, { kycRequired: false }],
      ["platform.kyc_requirement_changed", { kycRequired: false }, { kycRequired: true }],
    ]);
  });
});
```

Run: `(cd packages/db && npx vitest run src/repositories/platform-settings.test.ts)` → FAIL (module missing).

- [ ] **Step 5: Implement** `packages/db/src/repositories/platform-settings.ts`:

```ts
import { prisma, type DbTransaction } from "../client";

/** Whether clients must pass KYC before withdrawing. No row yet = the default, required. */
export async function isKycRequired(client: Pick<DbTransaction, "platformSettings"> = prisma): Promise<boolean> {
  const row = await client.platformSettings.findUnique({ where: { id: 1 }, select: { kycRequired: true } });
  return row?.kycRequired ?? true;
}

/**
 * Flips the KYC requirement for every client. Locks the singleton row so two
 * admins clicking at once write one audit entry per real change. Returns
 * whether the value changed.
 */
export async function setKycRequired(kycRequired: boolean, actorId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "PlatformSettings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`;
    const [row] = await tx.$queryRaw<{ kycRequired: boolean }[]>`SELECT "kycRequired" FROM "PlatformSettings" WHERE "id" = 1 FOR UPDATE`;
    const before = row?.kycRequired ?? true;
    if (before === kycRequired) return false;

    await tx.platformSettings.update({ where: { id: 1 }, data: { kycRequired } });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "platform.kyc_requirement_changed",
        targetType: "PlatformSettings",
        targetId: "1",
        before: { kycRequired: before },
        after: { kycRequired },
      },
    });
    return true;
  });
}
```

Export from `packages/db/src/index.ts` next to the other repository exports:

```ts
export { isKycRequired, setKycRequired } from "./repositories/platform-settings";
```

Run the test again → PASS.

- [ ] **Step 6: Real-money withdrawal gate: failing test.** In `packages/db/src/repositories/withdrawal.test.ts`, inside `describe("requestWithdrawal", ...)` directly after `"refuses a withdrawal until the user's KYC is verified"` (its `beforeEach` already gives the account 50,000 real balance and a week-old completed deposit), add:

```ts
  it("lets an unverified user withdraw when KYC is switched off", async () => {
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "NOT_STARTED" } });
    await setKycRequired(false, "test-withdrawal");
    try {
      const withdrawal = await requestWithdrawal({ actorId: userId, accountId, amount: 10_000, ...UPI });
      expect(withdrawal.status).toBe("REQUESTED");
    } finally {
      await setKycRequired(true, "test-withdrawal");
      await prisma.auditLog.deleteMany({ where: { actorId: "test-withdrawal" } });
    }
  });
```

Add `import { setKycRequired } from "./platform-settings";` to the file's imports. Run `(cd packages/db && npx vitest run src/repositories/withdrawal.test.ts)` → the new test FAILS with the "Verify your identity" refusal.

- [ ] **Step 7: Real-money withdrawal gate: implement.** In `withdrawal.ts` replace the KYC block (currently `if (actor.kycStatus !== "VERIFIED") { throw ... }`) with:

```ts
  // Payouts only go to verified identities while the admin's KYC switch is on
  // (the default) — KYC is what establishes the person is real and holds a
  // single account. With the switch off, no client is asked for KYC.
  if (actor.kycStatus !== "VERIFIED" && (await isKycRequired())) {
```

keeping the existing `throw new WithdrawalRefused(...)` body and the paragraph about payout destinations. Import `isKycRequired` from `./platform-settings`. Also update the doc comment at ~line 117 ("...and the account's KYC must be VERIFIED") to "...and, while the KYC switch is on, the account's KYC must be VERIFIED". Run the file again → PASS (all cases).

- [ ] **Step 8: Affiliate-program withdrawals.** In `program-wallet.ts` change the signature and KYC line:

```ts
export function programActionBlockers(
  u: ActorFacts,
  action: "transfer" | "withdraw",
  hasLiveAccount: boolean,
  kycRequired = true,
): ProgramRefusalCode[] {
  ...
  if (!affiliate && action === "withdraw" && kycRequired && u.kycStatus !== "VERIFIED") out.push("kyc_required");
```

In the wallet summary function (the `Promise.all` that ends with `countProgramWithdrawalsUsed(userId, now)`, ~line 340), add `isKycRequired()` as a new last element, destructure it as `kycRequired`, and pass it: `programActionBlockers(user, "withdraw", hasLive, kycRequired)`. Leave the `"transfer"` call as is. In `program-withdrawal.ts:65` (inside the transaction) use `programActionBlockers(user, "withdraw", true, await isKycRequired(tx))`. Import `isKycRequired` from `./platform-settings` in both files.

If a `programActionBlockers` unit test exists (`grep -rn programActionBlockers packages/db/src --include='*.test.ts'`), add one assertion there: a non-affiliate `NOT_STARTED` user gets `["kyc_required"]` for `"withdraw"` with the default and `[]` with `kycRequired = false`. If none exists, create `packages/db/src/repositories/program-wallet.test.ts` with exactly that pure test (no DB needed):

```ts
import { describe, expect, it } from "vitest";
import { programActionBlockers } from "./program-wallet";

const user = { status: "ACTIVE", role: "USER", legacySimulated: false, kycStatus: "NOT_STARTED" as const, affiliateProfile: null };

describe("programActionBlockers", () => {
  it("asks for KYC on withdraw only while the switch is on", () => {
    expect(programActionBlockers(user, "withdraw", true)).toEqual(["kyc_required"]);
    expect(programActionBlockers(user, "withdraw", true, false)).toEqual([]);
  });
});
```

- [ ] **Step 9: Run the db suites touched.** `(cd packages/db && npx vitest run src/repositories/platform-settings.test.ts src/repositories/withdrawal.test.ts src/repositories/program-wallet.test.ts)` and any `program-*.db.test.ts` → PASS.

---

### Task 4: Admin switch in Settings

**Files:**
- Create: `apps/web/src/app/admin/(console)/settings/actions.ts`
- Create: `apps/web/src/app/admin/(console)/settings/actions.test.ts`
- Modify: `apps/web/src/app/admin/(console)/settings/page.tsx`
- Modify: `apps/web/src/app/admin/_lib/audit.ts` (label)
- Modify: `apps/web/src/app/admin/(console)/withdrawals/page.tsx:~253-270`

**Interfaces:**
- Consumes: `isKycRequired`, `setKycRequired` from `@asm/db` (Task 3).
- Produces: server action `setKycRequiredAction(formData: FormData): Promise<void>` reading field `kycRequired` = `"true" | "false"`.

- [ ] **Step 1: Failing action test** `apps/web/src/app/admin/(console)/settings/actions.test.ts` (pattern copied from `users/actions.test.ts`):

```ts
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "t" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-session", () => ({ ADMIN_SESSION_COOKIE: "c", readAdminSession: async () => true }));

import { isKycRequired, prisma } from "@asm/db";
import { setKycRequiredAction } from "./actions";

afterAll(async () => {
  await prisma.platformSettings.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { action: "platform.kyc_requirement_changed", actorId: "admin-panel" } });
  await prisma.$disconnect();
});

function form(value: string): FormData {
  const f = new FormData();
  f.set("kycRequired", value);
  return f;
}

describe("KYC requirement action", () => {
  it("switches KYC off and on and ignores junk", async () => {
    await setKycRequiredAction(form("false"));
    expect(await isKycRequired()).toBe(false);
    await setKycRequiredAction(form("maybe"));
    expect(await isKycRequired()).toBe(false);
    await setKycRequiredAction(form("true"));
    expect(await isKycRequired()).toBe(true);
  });
});
```

Run `(cd apps/web && npx vitest run "src/app/admin/(console)/settings")` → FAIL.

- [ ] **Step 2: Implement** `actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { setKycRequired } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

const ADMIN_ACTOR = "admin-panel";

/** Turns the KYC requirement on or off for every client. Audited in setKycRequired. */
export async function setKycRequiredAction(formData: FormData): Promise<void> {
  const store = await cookies();
  if (!(await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value))) throw new Error("Not authorised.");

  const value = formData.get("kycRequired");
  if (value !== "true" && value !== "false") return;
  await setKycRequired(value === "true", ADMIN_ACTOR);

  revalidatePath("/admin/settings");
  revalidatePath("/admin/withdrawals");
}
```

Run the test → PASS.

- [ ] **Step 3: Settings page.** In `settings/page.tsx`: add `isKycRequired` to the `@asm/db` import and to the existing `Promise.all` (`const [userCount, assetCount, auditCount, kycRequired] = ...`); import `setKycRequiredAction` from `./actions`. Change the `PageHead` `desc` to:
`"Platform values come from the deposit and bonus engine and change with a release; collection accounts come from the environment. Client switches take effect immediately."`
Insert this card as the first card in the column (before `<Card title="Platform">`):

```tsx
        <Card title="Clients">
          <Row
            label="Require KYC to withdraw"
            desc={
              kycRequired
                ? "On: clients verify their identity before their first withdrawal."
                : "Off: clients withdraw without KYC and see no verification screens. Submitted documents are kept."
            }
            control={
              <form action={setKycRequiredAction} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Pill tone={kycRequired ? "pos" : "warn"}>{kycRequired ? "On" : "Off"}</Pill>
                <input type="hidden" name="kycRequired" value={kycRequired ? "false" : "true"} />
                <button type="submit" className={`admin-btn admin-btn--sm${kycRequired ? " admin-btn--danger" : " admin-btn--primary"}`}>
                  {kycRequired ? "Turn off" : "Turn on"}
                </button>
              </form>
            }
          />
        </Card>
```

Check `admin-btn--primary` and `admin-btn--danger` exist (`grep -rn "admin-btn--primary\|admin-btn--danger" apps/web/src/app/admin --include='*.css'`); use whichever variants exist.

- [ ] **Step 4: Audit label.** In `apps/web/src/app/admin/_lib/audit.ts`, next to the `kyc.*` entries, add `"platform.kyc_requirement_changed": "Changed the KYC requirement",`.

- [ ] **Step 5: Admin withdrawals queue.** In `withdrawals/page.tsx`, load `isKycRequired()` alongside the page's existing data and only show the `admin-kyc-warn` "KYC still pending / KYC not verified" line when `kycRequired` is true: `{kycRequired && !verified && tab !== "history" ? (...) : null}`. Keep the green `KYC` pill for verified users.

---

### Task 5: Web client hides KYC when the switch is off

**Files:**
- Modify: `apps/web/src/app/(platform)/withdrawal/page.tsx:26-28,84`
- Modify: `apps/web/src/app/(platform)/account/page.tsx` and `apps/web/src/components/account/AccountHub.tsx:57-63,96-103,171-178`
- Modify: `apps/web/src/app/(platform)/account/profile/page.tsx` and `apps/web/src/app/(platform)/account/ProfileForm.tsx:~92-102,~145-160`
- Modify: `apps/web/src/app/(platform)/account/verify/page.tsx`

**Interfaces:** Consumes `isKycRequired` from `@asm/db`. Each server page passes a `kycRequired: boolean` prop down; client components treat it as required (no default) so every caller is explicit.

- [ ] **Step 1: Withdrawal page.** Add `isKycRequired()` to the existing `Promise.all` that loads `accounts, profile` (`const [accounts, profile, kycRequired] = ...`). Change the gate to `{!kycRequired || profile.kycStatus === "VERIFIED" ? (<WithdrawForm .../>) : (...VerifyFirst...)}`. `kycName` stays as is: it is built from the profile's first/last name, which sign-up fills, so the bank-holder prefill still works without KYC.

- [ ] **Step 2: Account hub.** `account/page.tsx` loads `isKycRequired()` with its other data and passes `kycRequired` to `<AccountHub>`. In `AccountHub.tsx` add `kycRequired: boolean` to the props type and destructuring; render the KYC pill `<Link href="/account/verify" ...>{kyc.label}</Link>` (header, ~line 97) and the `"Identity verification"` `<LinkRow>` (~line 172) only when `kycRequired` is true.

- [ ] **Step 3: Profile page.** `account/profile/page.tsx` loads `isKycRequired()` and passes `kycRequired` to `<ProfileForm>`. In `ProfileForm.tsx` add the prop; when false, hide the KYC status pill next to "Personal data" and the KYC hint block (the `<p>{kycHint.text}</p>` plus its `/account/verify` link). Leave the rest of the form unchanged.

- [ ] **Step 4: Verify page.** In `verify/page.tsx`, right after the session check:

```ts
  // With KYC switched off there is nothing to verify; send people back to Account.
  if (!(await isKycRequired())) redirect("/account");
```

(import `isKycRequired` from `@asm/db`).

- [ ] **Step 5: Affiliate earnings panel.** No change: `ProgramEarningsPanel` only shows its "Verify identity" link when the server's blockers include `kyc_required`, which Task 3 already drops when the switch is off. Confirm by reading `apps/web/src/components/program/ProgramEarningsPanel.tsx:110-160`.

---

### Task 6: App API and Android app

**Files:**
- Modify: `packages/contracts/src/app.ts` (`BootstrapSchema` ~line 60, `WithdrawalPrefillSchema` ~line 166)
- Modify: `packages/contracts/src/app.test.ts` (defaults)
- Modify: `apps/web/src/app/api/v1/bootstrap/route.ts`
- Modify: `apps/web/src/lib/withdrawal-prefill.ts` (`loadWithdrawalPrefill`)
- Modify: `apps/web/src/app/api/v1/withdrawal-prefill/route.test.ts` (if it asserts the whole payload)
- Modify: `apps/mobile/src/account/hub-model.ts:44-46` + its test
- Modify: `apps/mobile/src/payments/hub-model.ts:45-47` + its test
- Modify: `apps/mobile/src/payments/withdraw-form.ts` (new `needsKycGate`) + `withdraw-form.test.ts`
- Modify: `apps/mobile/app/(tabs)/account/index.tsx:49-110`
- Modify: `apps/mobile/app/(tabs)/payments/index.tsx:105`
- Modify: `apps/mobile/src/payments/WithdrawForm.tsx:181`

**Interfaces:**
- Produces: `BootstrapSchema` and `WithdrawalPrefillSchema` gain `kycRequired: z.boolean().default(true)`. A missing field (older server) reads as required; older apps strip the unknown key.
- Produces (mobile): `showVerifyCard(status, kycRequired = true)`, `showKycNextStep(status, kycRequired = true)`, `needsKycGate(prefill: Pick<WithdrawalPrefill, "kycStatus" | "kycRequired">): boolean`.

- [ ] **Step 1: Contract tests first.** In `packages/contracts/src/app.test.ts` add `BootstrapSchema` to the `./app` import and append:

```ts
describe("kycRequired", () => {
  const bootstrap = {
    userId: "u-1",
    assets: [],
    accounts: [],
    recentTrades: [],
    defaultSymbol: "EURUSD_OTC",
    liveAccess: true,
    completedDeposits: 0,
    profile: { nickname: null, email: "a@b.com", kycStatus: "NOT_STARTED", locale: "en" },
  };
  const prefill = { lastPayouts: {}, initialMethod: null, kycName: "Asha Rao", kycStatus: "NOT_STARTED", heldWithdrawals: [] };

  it("reads a missing flag from an older server as required", () => {
    expect(BootstrapSchema.parse(bootstrap).kycRequired).toBe(true);
    expect(WithdrawalPrefillSchema.parse(prefill).kycRequired).toBe(true);
  });

  it("carries the switch when the server sends it", () => {
    expect(BootstrapSchema.parse({ ...bootstrap, kycRequired: false }).kycRequired).toBe(false);
    expect(WithdrawalPrefillSchema.parse({ ...prefill, kycRequired: false }).kycRequired).toBe(false);
  });
});
```

If `locale: "en"` is not a valid `LocaleSchema` value, use the first value that `LocaleSchema` in `app.ts` allows. Run `pnpm --filter @asm/contracts test` → FAIL.

- [ ] **Step 2: Contracts.** Add to `BootstrapSchema` (after `completedDeposits`) and to `WithdrawalPrefillSchema` (after `kycStatus`):

```ts
  /** False when the admin has switched KYC off: hide every KYC prompt. Absent from older servers = required. */
  kycRequired: z.boolean().default(true),
```

Run contracts tests → PASS.

- [ ] **Step 3: Server payloads.** `bootstrap/route.ts`: load `isKycRequired()` in the existing `Promise.all` and add `kycRequired` to the object passed to `BootstrapSchema.parse`. `withdrawal-prefill.ts` `loadWithdrawalPrefill`: load `isKycRequired()` in its `Promise.all` and return `kycRequired`. Fix any test fixtures that now need the field (`grep -rn "kycStatus" apps/web/src --include='*.test.ts'`).

- [ ] **Step 4: Mobile model tests first.**
  - `apps/mobile/src/account/hub-model.test.ts`: `expect(showVerifyCard("NOT_STARTED", false)).toBe(false)` and `expect(showVerifyCard("NOT_STARTED")).toBe(true)`.
  - `apps/mobile/src/payments/hub-model.test.ts`: `expect(showKycNextStep("REJECTED", false)).toBe(false)` and `expect(showKycNextStep("REJECTED")).toBe(true)`.
  - `apps/mobile/src/payments/withdraw-form.test.ts`:
    ```ts
    describe("needsKycGate", () => {
      it("gates unverified users only while KYC is required", () => {
        expect(needsKycGate({ kycStatus: "NOT_STARTED", kycRequired: true })).toBe(true);
        expect(needsKycGate({ kycStatus: "VERIFIED", kycRequired: true })).toBe(false);
        expect(needsKycGate({ kycStatus: "NOT_STARTED", kycRequired: false })).toBe(false);
      });
    });
    ```
  Existing `WithdrawalPrefill` fixtures in these tests now need `kycRequired: true`; add it.
  Run `(cd apps/mobile && npx vitest run src/account src/payments)` → FAIL.

- [ ] **Step 5: Mobile models.**

```ts
/** The "verify your account" card is only for someone with something to do, and only while KYC is required. */
export function showVerifyCard(status: KycStatus, kycRequired = true): boolean {
  return kycRequired && (status === "NOT_STARTED" || status === "REJECTED");
}
```

```ts
export function showKycNextStep(status: string | undefined, kycRequired = true): boolean {
  return kycRequired && (status === "NOT_STARTED" || status === "REJECTED");
}
```

In `withdraw-form.ts`:

```ts
/** The withdraw screen shows the verify-first gate instead of the form. */
export function needsKycGate(prefill: Pick<WithdrawalPrefill, "kycStatus" | "kycRequired">): boolean {
  return prefill.kycRequired && prefill.kycStatus !== "VERIFIED";
}
```

Run the mobile suites → PASS.

- [ ] **Step 6: Mobile screens.**
  - `app/(tabs)/account/index.tsx`: `const kycRequired = boot?.kycRequired ?? true;`. Show the `StatusTag` (and include `tagLabel` in the identity row's `accessibilityLabel`) only when `kycRequired`. The identity row's `onPress` goes to `"/account/verify"` when `kycRequired`, else `"/account/profile"`. The verify card condition becomes `status && showVerifyCard(status, kycRequired)`.
  - `app/(tabs)/payments/index.tsx:105`: `showKycNextStep(boot?.profile.kycStatus, boot?.kycRequired ?? true)`.
  - `src/payments/WithdrawForm.tsx:181`: `if (needsKycGate(prefill)) {` (import from `./withdraw-form`).
  - `app/(tabs)/account/verify.tsx`: no change (only reachable from the entry points above and from KYC push notifications, which only fire when an admin reviews a submission).

- [ ] **Step 7: Mobile typecheck and tests.** `(cd apps/mobile && npx tsc --noEmit && npx vitest run)` → clean / PASS.

---

### Task 7: Whole-branch verification (no commit)

- [ ] **Step 1:** With the Global Constraints env exported, from the repo root:
  - `pnpm typecheck` → no errors.
  - `pnpm lint` → no new errors in touched files.
  - `pnpm --filter @asm/contracts test`
  - `(cd packages/db && npx vitest run)`
  - `(cd apps/web && npx vitest run)`
  - `(cd apps/mobile && npx vitest run)`

  Record pass/fail counts. Some suites may already fail on `main` for fixture reasons unrelated to this work (e.g. a closed `AUDNZD_OTC` market after a fresh seed). For every failure, check `git diff --stat`: if neither the failing test file nor the code it covers was touched by this plan, report it as pre-existing with its error line. Never edit unrelated tests to make them pass. Never use `git stash` (the stash stack is shared with other sessions).
- [ ] **Step 2:** `git status --short` and `git diff --stat`. Report both in the final message, along with: the full list of files changed, the test commands and their results, and anything in the plan you could not do or did differently (with the reason).
- [ ] **Step 3:** Leave everything uncommitted. Do not delete the `asm_kyc_toggle` database.
