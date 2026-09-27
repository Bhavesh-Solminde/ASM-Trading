"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ChainCreditResolutionRefused,
  creditDepositToAccount,
  dismissChainCredit,
  rejectDeposit,
  resolveChainCreditToDeposit,
} from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

const ADMIN_ACTOR = "admin-panel";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

/**
 * Approves a pending deposit the feed never credited. creditId is null — the
 * operator is vouching for the payment out of band. creditDepositToAccount is
 * idempotent via its status guard, so a double submit credits at most once.
 */
export async function approveDepositAction(formData: FormData): Promise<void> {
  await requirePanel();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;

  await creditDepositToAccount({ depositId, adminId: ADMIN_ACTOR, creditId: null });
  logger.info(
    { evt: "admin.action", action: "deposit.approve", depositId },
    "deposit approved by admin",
  );
  revalidatePath("/admin/deposits");
  revalidatePath("/admin");
}

export async function rejectDepositAction(formData: FormData): Promise<void> {
  await requirePanel();
  const depositId = String(formData.get("depositId") ?? "");
  const reason = String(formData.get("reason") ?? "no matching credit");
  if (!depositId) return;

  await rejectDeposit({ depositId, adminId: ADMIN_ACTOR, reason });
  logger.info(
    { evt: "admin.action", action: "deposit.reject", depositId, reason },
    "deposit rejected by admin",
  );
  revalidatePath("/admin/deposits");
  revalidatePath("/admin");
}

/* ------------------------- USDT (TRC-20) manual review ------------------------ */

const USDT_TAB = "/admin/deposits?tab=usdt";
const NOTE_MAX = 500;

/**
 * Live USDT receiving config, re-read from the environment on every call.
 * Deliberately a local replica of usdtDepositConfig() in
 * app/api/deposits/route.ts (not imported from a route module): null unless
 * the whole config is present and valid, so a resolve can never run against a
 * half-configured server.
 */
function usdtDepositConfig(): { network: string; tokenContract: string; receivingAddress: string } | null {
  const network = process.env["USDT_NETWORK"] ?? "";
  const trongridNetwork = process.env["USDT_TRONGRID_NETWORK"] ?? "";
  const tokenContract = process.env["USDT_TOKEN_CONTRACT"] ?? "";
  const receivingAddress = process.env["USDT_RECEIVING_ADDRESS"] ?? "";
  const trongridNetworkValid = trongridNetwork === "mainnet" || trongridNetwork === "nile";
  if (network !== "tron" || !trongridNetworkValid || !tokenContract || !receivingAddress) return null;
  return { network, tokenContract, receivingAddress };
}

function usdtError(message: string): never {
  redirect(`${USDT_TAB}&error=${encodeURIComponent(message)}`);
}

function isResolutionRefusal(err: unknown): err is Error {
  return (
    err instanceof ChainCreditResolutionRefused ||
    (err instanceof Error && err.name === "ChainCreditResolutionRefused")
  );
}

function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Credits an on-chain USDT payment that landed in manual review to a deposit
 * the operator picked. The db layer credits the RECEIVED amount (not the
 * deposit's reserved amount) and re-verifies network / token contract /
 * receiving address against the live config passed here; any refusal comes
 * back as ChainCreditResolutionRefused and is shown on the review tab.
 */
export async function resolveChainCreditAction(formData: FormData): Promise<void> {
  await requirePanel();
  const chainCreditId = formString(formData, "chainCreditId");
  const depositId = formString(formData, "depositId");
  if (!chainCreditId || !depositId) usdtError("Pick a deposit to credit this payment to.");

  const config = usdtDepositConfig();
  if (!config) {
    usdtError("USDT deposits are not configured on this server — cannot verify the payment against the live receiving config.");
  }

  let refusal: string | null = null;
  try {
    await resolveChainCreditToDeposit({
      chainCreditId,
      depositId,
      adminId: ADMIN_ACTOR,
      expectedNetwork: config.network,
      expectedTokenContract: config.tokenContract,
      expectedReceivingAddress: config.receivingAddress,
    });
  } catch (err) {
    if (!isResolutionRefusal(err)) throw err;
    refusal = err.message || "The payment could not be credited.";
  }

  revalidatePath("/admin/deposits");
  revalidatePath("/admin");

  if (refusal !== null) {
    logger.warn(
      { evt: "admin.action", action: "chain_credit.resolve", chainCreditId, depositId, refused: refusal },
      "chain credit resolve refused",
    );
    usdtError(refusal);
  }

  logger.info(
    { evt: "admin.action", action: "chain_credit.resolve", chainCreditId, depositId },
    "chain credit resolved to deposit by admin",
  );
  redirect(`${USDT_TAB}&ok=resolved`);
}

/** Closes out an on-chain payment that will not be credited (refunded, spam, …). */
export async function dismissChainCreditAction(formData: FormData): Promise<void> {
  await requirePanel();
  const chainCreditId = formString(formData, "chainCreditId");
  const note = formString(formData, "note");
  if (!chainCreditId) usdtError("Missing payment id.");
  if (!note) usdtError("A dismissal note is required.");
  if (note.length > NOTE_MAX) usdtError(`Dismissal note must be ${NOTE_MAX} characters or fewer.`);

  let refusal: string | null = null;
  try {
    await dismissChainCredit({ chainCreditId, adminId: ADMIN_ACTOR, note });
  } catch (err) {
    if (!isResolutionRefusal(err)) throw err;
    refusal = err.message || "The payment could not be dismissed.";
  }

  revalidatePath("/admin/deposits");
  revalidatePath("/admin");

  if (refusal !== null) {
    logger.warn(
      { evt: "admin.action", action: "chain_credit.dismiss", chainCreditId, refused: refusal },
      "chain credit dismiss refused",
    );
    usdtError(refusal);
  }

  logger.info(
    { evt: "admin.action", action: "chain_credit.dismiss", chainCreditId, note },
    "chain credit dismissed by admin",
  );
  redirect(`${USDT_TAB}&ok=dismissed`);
}
