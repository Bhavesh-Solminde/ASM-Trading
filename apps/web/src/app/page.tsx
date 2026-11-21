import { BoldLanding } from "@/components/marketing/BoldLanding";
import { faqs } from "@/components/marketing/marketing-data";
import { JsonLd, faqSchema } from "@/components/seo/JsonLd";
import { MetaPixel } from "@/components/seo/MetaPixel";

// Static: the proxy sends signed-in visitors to /trade before this renders,
// and the pixel fetches its IDs, so nothing here depends on the request.
export default function Home() {
  return (
    <>
      {/* The landing renders these FAQs visually, so FAQPage schema is a
          faithful representation — eligible for rich results / AI answers. */}
      <JsonLd data={faqSchema(faqs)} />
      <BoldLanding />
      <MetaPixel />
    </>
  );
}
