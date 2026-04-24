import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",   // static export for Capacitor & PWA
  images: { unoptimized: true },
};

export default nextConfig;
