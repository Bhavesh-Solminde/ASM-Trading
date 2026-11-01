import { noStoreJson } from "@/lib/request-session";

export function GET() {
  return noStoreJson({ publicKey: process.env["VAPID_PUBLIC_KEY"] || null });
}
