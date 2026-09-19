import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { BoldLanding } from "@/components/marketing/BoldLanding";

export default async function Home() {
  const store = await cookies();
  if (await readSession(store.get(SESSION_COOKIE)?.value)) redirect("/trade");
  return <BoldLanding />;
}
