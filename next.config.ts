import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Vercel-compatible config — no "output: standalone" (that's for Docker only) */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
