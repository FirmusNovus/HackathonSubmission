import type { NextAuthConfig, DefaultSession } from "next-auth";
import { Role } from "@/lib/db/enums";

declare module "next-auth" {
  interface User {
    id?: string;
    role: Role;
    walletAddress: string;
    ebsiWalletProvider: string | null;
    /**
     * True when this session was minted via the dev-login bypass (no real
     * wallet signature). Lets API endpoints that gate on a per-action wallet
     * sig skip the check for fixture users in tests + local dev. Always
     * absent / false for SIWE-authenticated sessions.
     */
    devLogin?: boolean;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      walletAddress: string;
      ebsiWalletProvider: string | null;
      devLogin?: boolean;
    } & DefaultSession["user"];
  }
}

/**
 * Edge-runtime-safe auth config. The middleware imports this so it can run in
 * the Edge bundle — no Prisma, no node:fs, no chain RPC. The actual SIWE
 * provider lives in `config.ts` (Node-only) where it can call into the DB and
 * read on-chain attestations.
 *
 * The middleware uses only the JWT-decoded session token + the authorized
 * callback below, so this minimal config is sufficient.
 */
export const authConfig = {
  providers: [],
  pages: {
    signIn: "/connect",
  },
  session: { strategy: "jwt" },
  callbacks: {
    jwt: async ({ token, user, trigger, session }) => {
      if (user) {
        token.id = user.id ?? token.id;
        token.role = user.role;
        token.walletAddress = user.walletAddress;
        token.ebsiWalletProvider = user.ebsiWalletProvider;
        token.devLogin = user.devLogin === true;
      }
      // useSession().update({ role: "LAWYER", name: "..." }) — used by the
      // lawyer-cred onboarding step to lift the JWT's role from CLIENT to
      // LAWYER right after the on-chain attestation is written, and to
      // backfill the disclosed bar-credential name into the JWT so all the
      // pages that read `session.user.name` (dashboard greeting, profile
      // editor, consultation views) see it without a sign-out/in cycle.
      if (trigger === "update" && session && typeof session === "object") {
        const s = session as { role?: Role; name?: string };
        if (s.role === Role.CLIENT || s.role === Role.LAWYER) {
          token.role = s.role;
        }
        if (typeof s.name === "string" && s.name.length > 0) {
          token.name = s.name;
        }
      }
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      session.user.walletAddress = token.walletAddress as string;
      session.user.ebsiWalletProvider = token.ebsiWalletProvider as string | null;
      session.user.devLogin = token.devLogin === true;
      return session;
    },
    authorized: ({ auth, request }) => {
      const { pathname } = request.nextUrl;
      const isClient = pathname.startsWith("/client");
      const isLawyer = pathname.startsWith("/lawyer");
      const isAdmin = pathname.startsWith("/admin");
      if (!isClient && !isLawyer && !isAdmin) return true;
      if (!auth?.user) return false;
      if (isClient && auth.user.role !== Role.CLIENT && auth.user.role !== Role.LAWYER) return false;
      if (isLawyer && auth.user.role !== Role.LAWYER) return false;
      if (isAdmin && auth.user.role !== Role.OPERATOR) return false;
      return true;
    },
  },
} satisfies NextAuthConfig;
