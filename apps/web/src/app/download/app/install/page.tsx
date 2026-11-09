import Link from "next/link";
import { connection } from "next/server";
import { LogoEmblem, LogoWordmark } from "@/components/brand/Logo";
import { SEMVER } from "@/lib/release-files";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Install the Android app",
  description: "Download IndianxTrade for Android and follow the installation steps.",
  path: "/download/app/install",
});

const steps = [
  {
    title: "Download the app",
    body: "On your Android phone, tap Download for Android. Open the downloaded file from your browser when it’s ready.",
  },
  {
    title: "Allow the install if prompted",
    body: "If Android blocks the install, tap Settings and turn on Allow from this source for your browser.",
  },
  {
    title: "Install and open the app",
    body: "Go back and tap Install, then tap Open. If you enabled the browser’s install permission, turn it off again in Settings.",
  },
];

export default async function AndroidInstallPage() {
  await connection();
  const version = process.env["APP_LATEST_VERSION"]?.trim() ?? "";
  const download = SEMVER.test(version) ? `/download/app/${version}` : null;

  return (
    <div className="min-h-dvh bg-ground text-ink">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <Link href="/" aria-label="IndianxTrade home"><LogoWordmark compact className="h-6" /></Link>
          <Link href="/#get-the-app" className="text-sm font-semibold text-ink-2 hover:text-ink">Back to homepage</Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl items-start gap-8 px-5 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12 lg:py-16">
        <section aria-labelledby="android-download-heading" className="rounded-2xl border border-brand/30 bg-panel p-5 sm:p-8">
          <div className="flex items-center gap-3">
            <LogoEmblem title="" className="size-12 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-ink">IndianxTrade</p>
              <p className="text-sm text-ink-2">Android app{download ? ` · Version ${version}` : ""}</p>
            </div>
          </div>
          <h1 id="android-download-heading" className="mt-5 text-balance text-[clamp(1.9rem,5vw,2.625rem)] font-black leading-tight tracking-tight">
            Install IndianxTrade on Android
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-2 sm:text-base">
            Download the app from IndianxTrade and follow the three steps to install it on your phone.
          </p>
          {download ? (
            <a href={download} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-fill px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-fill-hi sm:w-auto">
              <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
              </svg>
              Download for Android
            </a>
          ) : (
            <p className="mt-6 rounded-lg border border-rule bg-tile px-4 py-3 text-sm text-ink">The Android download is currently unavailable. Check back later.</p>
          )}
        </section>

        <section aria-labelledby="android-steps-heading" className="rounded-2xl border border-rule bg-panel/70 p-5 sm:p-8">
          <h2 id="android-steps-heading" className="text-2xl font-bold tracking-tight">How to install</h2>
          <ol role="list" className="mt-5 divide-y divide-rule border-y border-rule">
            {steps.map(({ title, body }, index) => (
              <li key={title} className="flex items-start gap-3 py-4 sm:gap-4">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-dim text-sm font-bold text-ink">{index + 1}</span>
                <div>
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm leading-relaxed text-ink-2">
            <strong className="text-ink">Updating the app?</strong> Install over your existing copy to keep your settings. Only install updates signed by the same publisher.
          </p>
        </section>
      </main>
    </div>
  );
}
