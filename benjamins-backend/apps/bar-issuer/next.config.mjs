/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@lex-nova/db-toolkit",
    "@lex-nova/oid4vci",
    "@lex-nova/sd-jwt",
  ],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
