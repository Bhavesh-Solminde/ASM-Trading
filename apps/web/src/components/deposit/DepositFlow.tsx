"use client";

import { useState } from "react";
import type { DEPOSIT_METHODS } from "@asm/contracts";
import { MethodPicker } from "@/components/deposit/MethodPicker";
import { AmountStep } from "@/components/deposit/AmountStep";

type Method = (typeof DEPOSIT_METHODS)[number];

export function DepositFlow() {
  const [method, setMethod] = useState<Method | null>(null);

  return method === null ? (
    <MethodPicker onPick={setMethod} />
  ) : (
    <AmountStep method={method} onBack={() => setMethod(null)} />
  );
}
