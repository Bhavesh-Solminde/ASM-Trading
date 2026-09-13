import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@asm/db", "@asm/config", "@asm/logger", "@asm/contracts"],
  productionBrowserSourceMaps: false,
};

export default nextConfig;
