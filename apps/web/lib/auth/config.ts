import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { SiweMessage } from "siwe";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getAttestationStatus } from "@/lib/chain/attestations";
import { operatorAddress } from "@/lib/chain/clients";
import { authConfig } from "./edge-config";

// JWT augmentation skipped — Auth.js v5's JWT module path resolves differently
// in build vs dev. Token fields are still validated at runtime in the
// jwt/session callbacks below; we just lose static type-narrowing on `token`.

// `dev-login` is enabled in real dev (NODE_ENV !== "production") OR when
// ENABLE_MOCK_AUTH is set explicitly. The latter is used by the Playwright
// webServer so that the production build under test still has a usable
// auth bypass without exposing it on actual prod deploys.
const isDev = process.env.NODE_ENV !== "production" || process.env.ENABLE_MOCK_AUTH === "true";

const devLoginProvider = Credentials({
  id: "dev-login",
  name: "Dev login (test only)",
  credentials: {
    walletAddress: { label: "Wallet", type: "text" },
    role: { label: "Role", type: "text" },
  },
  authorize: async (credentials) => {
    if (!isDev) return null;
    const wallet = String(credentials?.walletAddress ?? "").toLowerCase();
    if (!wallet) return null;
    const requestedRole =
      String(credentials?.role ?? "CLIENT").toUpperCase() === "LAWYER" ? Role.LAWYER : Role.CLIENT;
    const existing = await prisma.user.findUnique({ where: { walletAddress: wallet } });
    const user =
      existing ??
      (await prisma.user.create({
        data: { walletAddress: wallet, role: requestedRole, ebsiWalletProvider: "ds" },
      }));
    return {
      id: user.id,
      role: user.role as Role,
      walletAddress: user.walletAddress,
      ebsiWalletProvider: user.ebsiWalletProvider,
      // Marker so per-action signature checks know to skip — these fixture
      // wallets have no private key we can sign with.
      devLogin: true,
      name: user.name ?? undefined,
      email: user.email ?? undefined,
      image: user.avatarUrl ?? undefined,
    };
  },
});

const config = {
  // Reuse the edge-safe callbacks so middleware (which runs against `authConfig`
  // directly) and the Node runtime (which runs against this `config`) agree on
  // jwt/session/authorized — including the `trigger==="update"` merge that
  // lifts role from CLIENT → LAWYER after lawyer/finalize.
  ...authConfig,
  providers: [
    Credentials({
      id: "siwe",
      name: "Wallet (SIWE)",
      credentials: {
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
        role: { label: "Role", type: "text" },
        ebsiWalletProvider: { label: "EBSI provider", type: "text" },
      },
      authorize: async (credentials) => {
        if (!credentials?.message || !credentials.signature) return null;
        let siwe: SiweMessage;
        try {
          siwe = new SiweMessage(JSON.parse(String(credentials.message)));
        } catch {
          return null;
        }

        const result = await siwe.verify({ signature: String(credentials.signature) }).catch(() => null);
        if (!result?.success) return null;

        const nonceRow = await prisma.nonce.findUnique({ where: { nonce: siwe.nonce } });
        if (!nonceRow || nonceRow.used) return null;
        await prisma.nonce.update({ where: { id: nonceRow.id }, data: { used: true } });

        const wallet = siwe.address.toLowerCase();
        const ebsi = credentials.ebsiWalletProvider ? String(credentials.ebsiWalletProvider) : null;

        // Source of truth for role is the on-chain attestation set, not what
        // the client claims. Returning users with a SCHEMA_LAWYER attestation
        // are restored as LAWYER even if they previously had role CLIENT in
        // our DB; first-time visitors default to CLIENT until they go through
        // the lawyer-credential onboarding step. The platform operator
        // wallet is detected up front and pinned to OPERATOR — they don't
        // go through PID/bar onboarding and skip the chain attestation
        // lookup (which they don't have / don't need).
        const isOperator = wallet === operatorAddress().toLowerCase();
        let inferredRole: Role;
        if (isOperator) {
          inferredRole = Role.OPERATOR;
        } else {
          const onChain = await getAttestationStatus(wallet);
          inferredRole = onChain.lawyer ? Role.LAWYER : Role.CLIENT;
        }

        const existing = await prisma.user.findUnique({ where: { walletAddress: wallet } });
        const user = existing
          ? await prisma.user.update({
              where: { id: existing.id },
              data: {
                ...(existing.role !== inferredRole ? { role: inferredRole } : {}),
                ...(ebsi && existing.ebsiWalletProvider !== ebsi ? { ebsiWalletProvider: ebsi } : {}),
              },
            })
          : await prisma.user.create({
              data: {
                walletAddress: wallet,
                role: inferredRole,
                ebsiWalletProvider: ebsi,
              },
            });

        return {
          id: user.id,
          role: user.role as Role,
          walletAddress: user.walletAddress,
          ebsiWalletProvider: user.ebsiWalletProvider,
          name: user.name ?? undefined,
          email: user.email ?? undefined,
          image: user.avatarUrl ?? undefined,
        };
      },
    }),
    ...(isDev ? [devLoginProvider] : []),
  ],
} satisfies NextAuthConfig;

export const { auth, handlers, signIn, signOut } = NextAuth(config);
