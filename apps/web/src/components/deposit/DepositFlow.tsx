"use client";

import { useState } from "react";
import type { DEPOSIT_METHODS, UsdtNetwork } from "@asm/contracts";
import { MethodPicker } from "@/components/deposit/MethodPicker";
import { AmountStep } from "@/components/deposit/AmountStep";
import { UsdtAmountStep } from "@/components/deposit/UsdtAmountStep";

type Method = (typeof DEPOSIT_METHODS)[number];

/**
 * `usdtNetworks` is computed server-side from the live receiving config (only
 * networks a watcher is actually watching); an empty list hides USDT entirely.
 */
export function DepositFlow({ usdtNetworks }: { usdtNetworks: UsdtNetwork[] }) {
  const [method, setMethod] = useState<Method | null>(null);

  if (method === null) return <MethodPicker onPick={setMethod} usdtEnabled={usdtNetworks.length > 0} />;
  if (method === "USDT" && usdtNetworks.length > 0) {
    return <UsdtAmountStep networks={usdtNetworks} onBack={() => setMethod(null)} />;
  }
  if (method === "USDT") return <MethodPicker onPick={setMethod} usdtEnabled={false} />;
  return <AmountStep method={method} onBack={() => setMethod(null)} />;
}
