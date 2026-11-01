import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MetaPixel } from "@/components/seo/MetaPixel";
import { LOGIN_PIXEL_COOKIE } from "@/lib/ad-landing";
import { metaPixelIds } from "@/lib/meta-pixel";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { LoginComplete } from "./LoginComplete";

export const dynamic = "force-dynamic";

export default async function LoginWelcomePage() {
  const store = await cookies();
  if (!(await readSession(store.get(SESSION_COOKIE)?.value))) redirect("/login");
  const receipt = store.get(LOGIN_PIXEL_COOKIE)?.value;
  if (!receipt || !/^[a-f0-9]{32}$/.test(receipt)) redirect("/trade");
  return <><MetaPixel pixelIds={metaPixelIds()} /><LoginComplete receipt={receipt} /></>;
}
