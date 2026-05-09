/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Mount the entire issuer under /issuer so its emitted asset URLs
  // (/_next/...) end up at /issuer/_next/... — those go back through the
  // path-routed proxy and reach the issuer process, instead of leaking into
  // the platform's bundle space. The proxy adds the /issuer prefix to the
  // wallet's /api/issuer/* requests before forwarding.
  basePath: '/issuer',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

export default nextConfig;
