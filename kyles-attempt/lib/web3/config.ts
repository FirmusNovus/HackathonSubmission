// All Ethereum interactions in the UI are currently mocked. This module is
// intentionally empty — RainbowKit / wagmi providers and connectors have been
// removed from the client tree.
//
// TODO(production): when a real wallet flow is needed, add a wagmi config here
// (e.g. RainbowKit's `getDefaultConfig` with a real WalletConnect projectId
// from cloud.reown.com), wire `<WagmiProvider>` + `<RainbowKitProvider>` into
// components/providers.tsx, and replace the mock buttons in
// app/connect/connect-flow.tsx and components/firmus/wallet-button.tsx.

export {};
