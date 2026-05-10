import type { NextConfig } from "next";

const config: NextConfig = {
  // Mount everything in the issuer process under `/issuer`. The proxy at :3000
  // routes /issuer/* here; everything else goes to the platform. This makes
  // the platform/issuer separation visible on the URL: any wallet-visible
  // credential URL starts with `/issuer/`, so it's structurally impossible
  // for the platform to even receive credential traffic.
  basePath: "/issuer",
  serverExternalPackages: ["better-sqlite3"],
};

export default config;
