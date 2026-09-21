import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { BoldLanding } from "@/components/marketing/BoldLanding";
import { faqs } from "@/components/marketing/marketing-data";
import { JsonLd, faqSchema } from "@/components/seo/JsonLd";

export default async function Home() {
  const store = await cookies();
  if (await readSession(store.get(SESSION_COOKIE)?.value)) redirect("/trade");
  return (
    <>
      {/* The landing renders these FAQs visually, so FAQPage schema is a
          faithful representation — eligible for rich results / AI answers. */}
      <JsonLd data={faqSchema(faqs)} />
      <BoldLanding />
    </>
  );
}
