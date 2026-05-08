import type { NextConfig } from "next";

const config: NextConfig = {
  // Allow tooling (Playwright) to build into a sibling directory so it doesn't
  // overwrite the dev server's `.next` and strand its in-memory chunk paths.
  // Set NEXT_DIST_DIR=.next-test in the test webServer.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  images: {
    remotePatterns: [],
  },
};

export default config;
