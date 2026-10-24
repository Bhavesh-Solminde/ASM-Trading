"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackLogin } from "@/components/seo/MetaPixel";

export function LoginComplete({ receipt }: { receipt: string }) {
  const router = useRouter();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    let alreadyTracked = false;
    try {
      alreadyTracked = sessionStorage.getItem("ixt:login-receipt") === receipt;
      sessionStorage.setItem("ixt:login-receipt", receipt);
    } catch { /* Navigation still works when storage is unavailable. */ }
    if (!alreadyTracked) trackLogin("google");
    router.replace("/trade");
  }, [receipt, router]);
  return <p className="p-6 text-center">You’re signed in. <Link href="/trade" className="underline">Continue to your workspace</Link></p>;
}
