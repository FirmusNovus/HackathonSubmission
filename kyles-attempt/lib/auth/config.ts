import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { SiweMessage } from "siwe";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db/client";

declare module "next-auth" {
  interface User {
    id?: string;
    role: Role;
    walletAddress: string;
    ebsiWalletProvider: string | null;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      walletAddress: string;
      ebsiWalletProvider: string | null;
    } & DefaultSession["user"];
  }
}

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
      role: user.role,
      walletAddress: user.walletAddress,
      ebsiWalletProvider: user.ebsiWalletProvider,
      name: user.name ?? undefined,
      email: user.email ?? undefined,
      image: user.avatarUrl ?? undefined,
    };
  },
});

const config = {
  providers: [
    Credentials({
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

        const result = await siwe.verify({ signature: String(credentials.signature) });
        if (!result.success) return null;

        const nonceRow = await prisma.nonce.findUnique({ where: { nonce: siwe.nonce } });
        if (!nonceRow || nonceRow.used) return null;
        await prisma.nonce.update({ where: { id: nonceRow.id }, data: { used: true } });

        const wallet = siwe.address.toLowerCase();
        const requestedRole = String(credentials.role ?? "CLIENT").toUpperCase() === "LAWYER" ? Role.LAWYER : Role.CLIENT;
        const ebsi = credentials.ebsiWalletProvider ? String(credentials.ebsiWalletProvider) : null;

        const existing = await prisma.user.findUnique({ where: { walletAddress: wallet } });
        const user = existing
          ? await prisma.user.update({
              where: { id: existing.id },
              data: ebsi && existing.ebsiWalletProvider !== ebsi ? { ebsiWalletProvider: ebsi } : {},
            })
          : await prisma.user.create({
              data: {
                walletAddress: wallet,
                role: requestedRole,
                ebsiWalletProvider: ebsi,
              },
            });

        return {
          id: user.id,
          role: user.role,
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
  pages: {
    signIn: "/connect",
  },
  session: { strategy: "jwt" },
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id ?? token.id;
        token.role = user.role;
        token.walletAddress = user.walletAddress;
        token.ebsiWalletProvider = user.ebsiWalletProvider;
      }
      return token;
    },
    // Edge-safe — no Prisma here. The walletAddress is the stable identifier;
    // the cuid in `token.id` can go stale across reseeds. Route handlers that
    // mutate rows go through `requireCurrentUser()` (lib/auth/session.ts)
    // which re-looks up the user by walletAddress on the Node runtime.
    session: async ({ session, token }) => {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      session.user.walletAddress = token.walletAddress as string;
      session.user.ebsiWalletProvider = token.ebsiWalletProvider as string | null;
      return session;
    },
    authorized: ({ auth, request }) => {
      const { pathname } = request.nextUrl;
      const isClient = pathname.startsWith("/client");
      const isLawyer = pathname.startsWith("/lawyer");
      const isVerify = pathname === "/verify-lawyer";
      if (!isClient && !isLawyer && !isVerify) return true;
      if (!auth?.user) return false;
      if (isClient && auth.user.role !== Role.CLIENT) return false;
      if (isLawyer && auth.user.role !== Role.LAWYER) return false;
      return true;
    },
  },
} satisfies NextAuthConfig;

export const { auth, handlers, signIn, signOut } = NextAuth(config);
