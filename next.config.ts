import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a dev server run next to a production build without sharing build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
};

export default nextConfig;
