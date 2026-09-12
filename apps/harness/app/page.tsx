import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "48px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <h1 style={{ fontSize: 24, margin: 0 }}>ASM Relay — Test Build</h1>
      <p style={{ color: "#93a2b4", lineHeight: 1.5, margin: 0 }}>
        Companion app that forwards bank SMS from your phone to this test
        server. Demonstration/testing use only — not the production ASM
        Trade platform.
      </p>

      <a
        href="/asm-relay.apk"
        download
        style={{
          background: "#2fbd85",
          color: "#06231a",
          borderRadius: 8,
          padding: "14px 20px",
          textAlign: "center",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        Download APK
      </a>

      <div style={{ color: "#6b7a8d", fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ margin: "0 0 6px" }}>To install on Android:</p>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Open this page in your phone&apos;s browser and tap Download APK.</li>
          <li>
            If prompted, allow &quot;Install unknown apps&quot; for your
            browser.
          </li>
          <li>Open the downloaded file and install it.</li>
          <li>Grant the SMS permission when the app asks, then tap Start listening.</li>
        </ol>
      </div>

      <Link href="/messages" style={{ color: "#3d8bfd", fontSize: 13, textAlign: "center" }}>
        View received messages →
      </Link>
    </main>
  );
}
