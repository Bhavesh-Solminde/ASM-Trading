"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { trackPixelEvent } from "@/components/seo/MetaPixel";

/** Records the signup with the pixel (mounted just before this), then goes on to /trade. */
export function SignupComplete() {
  const router = useRouter();
  useEffect(() => {
    trackPixelEvent("CompleteRegistration");
    router.replace("/trade");
  }, [router]);
  return null;
}
