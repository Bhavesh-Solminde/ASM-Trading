import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "no-cache" },
      { key: "Service-Worker-Allowed", value: "/" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
    ] }];
  },
  transpilePackages: ["@asm/db", "@asm/config", "@asm/logger", "@asm/mail", "@asm/contracts", "@asm/trading", "@asm/tatum", "@asm/client-core"],
  productionBrowserSourceMaps: false,
  // Set DEV_LAN_HOST=<your Mac's LAN IP> to open the dev server from a phone on the same Wi-Fi.
  allowedDevOrigins: process.env.DEV_LAN_HOST ? [process.env.DEV_LAN_HOST] : [],
};

export default nextConfig;
