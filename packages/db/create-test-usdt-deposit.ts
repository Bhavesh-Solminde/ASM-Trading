import { createUsdtDepositIntent, prisma } from "./src/index";

async function main() {
  // Uses one of the seeded test users from `pnpm --filter @asm/db seed`.
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "test1@asmtrade.local" },
  });

  const network = process.env["USDT_NETWORK"];
  const tokenContract = process.env["USDT_TOKEN_CONTRACT"];
  const receivingAddress = process.env["USDT_RECEIVING_ADDRESS"];
  if (!network || !tokenContract || !receivingAddress) {
    throw new Error(
      "USDT_NETWORK / USDT_TOKEN_CONTRACT / USDT_RECEIVING_ADDRESS must be set in .env before running this script.",
    );
  }

  const deposit = await createUsdtDepositIntent({
    userId: user.id,
    amountUsdtMinorRequested: 1500, // $15.00 requested, in USDT-cents — well above the $10 minimum even after the small reservation offset; the actual reserved amount will be perturbed slightly for matching purposes
    network,
    tokenContract,
    receivingAddress,
    correlationId: "manual-testnet-test",
  });

  console.log("");
  console.log("Deposit created:", deposit.id);
  console.log("Send EXACTLY this amount of USDT to", receivingAddress);
  console.log(">>>", (deposit.amountUsdtMinor! / 100).toFixed(2), "USDT <<<");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
