import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@asm/db", "@asm/config", "@asm/logger", "@asm/contracts", "@asm/trading"],
  productionBrowserSourceMaps: false,
  // Set DEV_LAN_HOST=<your Mac's LAN IP> to open the dev server from a phone on the same Wi-Fi.
  allowedDevOrigins: process.env.DEV_LAN_HOST ? [process.env.DEV_LAN_HOST] : [],
};

export default nextConfig;
