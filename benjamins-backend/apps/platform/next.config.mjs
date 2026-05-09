/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TypeScript source; Next.js needs to transpile them
  // (it doesn't compile node_modules by default).
  transpilePackages: [
    "@lex-nova/crypto",
    "@lex-nova/dcql",
    "@lex-nova/db-toolkit",
    "@lex-nova/sd-jwt",
  ],
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
    instrumentationHook: true,
  },
  webpack: (config, { isServer }) => {
    config.externals.push("pino-pretty", "encoding");

    // Silence harmless transitive-dep warnings that flood the dev log on
    // every route recompile:
    //   * @metamask/sdk imports @react-native-async-storage/async-storage
    //     for its (unused-here) React Native code path
    //   * ox's tempo module uses a dynamic require webpack can't analyze
    // Both are runtime-safe; we'd see real errors, not just compile noise,
    // if they actually mattered.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/@metamask\/sdk/ },
      { module: /node_modules\/ox\/.*tempo/ },
      /Critical dependency: the request of a dependency is an expression/,
    ];
    if (!isServer) {
      // Tell webpack the missing optional dep is intentionally absent so it
      // stops re-checking it.
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        "@react-native-async-storage/async-storage": false,
      };
    }
    return config;
  },
};

export default nextConfig;
