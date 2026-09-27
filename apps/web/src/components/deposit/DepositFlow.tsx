"use client";

import { useState } from "react";
import type { DEPOSIT_METHODS } from "@asm/contracts";
import { MethodPicker } from "@/components/deposit/MethodPicker";
import { AmountStep } from "@/components/deposit/AmountStep";
import { UsdtAmountStep } from "@/components/deposit/UsdtAmountStep";

type Method = (typeof DEPOSIT_METHODS)[number];

export function DepositFlow() {
  const [method, setMethod] = useState<Method | null>(null);

  if (method === null) return <MethodPicker onPick={setMethod} />;
  if (method === "USDT") return <UsdtAmountStep onBack={() => setMethod(null)} />;
  return <AmountStep method={method} onBack={() => setMethod(null)} />;
}
